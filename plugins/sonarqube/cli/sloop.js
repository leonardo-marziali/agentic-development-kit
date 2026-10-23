'use strict';

/*
 * One SLOOP process and the JSON-RPC conversation with it.
 *
 * SLOOP is the backend SonarQube for IDE runs: sonarlint-backend-cli, a JVM
 * speaking lsp4j JSON-RPC (Content-Length framing) over stdio. The protocol
 * is two-way — SLOOP calls back into the client to list files, read the base
 * dir and stream issues — so this module is as much a server as a client.
 * Method names and DTO shapes are from sonarlint-core's rpc-protocol module;
 * see docs/SLOOP_PROTOCOL_NOTES.md.
 *
 * Standalone mode only: no connections, no binding, no server-sent events,
 * no telemetry. Nothing in here makes a network call.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const rpc = require('vscode-jsonrpc/node');

const CLIENT_NAME = 'SonarQube plugin for Claude Code';
const SCOPE_ID = 'project';
const LOG_BUFFER = 300;

/*
 * Extension → SLOOP Language, for the languages the pinned analyzers cover.
 * Anything else is sent with no language and left to SLOOP's own detection;
 * the secrets analyzer is content-based and still sees it.
 */
const LANGUAGE_BY_EXTENSION = {
  '.js': 'JS',
  '.jsx': 'JS',
  '.mjs': 'JS',
  '.cjs': 'JS',
  '.vue': 'JS',
  '.ts': 'TS',
  '.tsx': 'TS',
  '.mts': 'TS',
  '.cts': 'TS',
  '.css': 'CSS',
  '.scss': 'CSS',
  '.less': 'CSS',
  '.py': 'PYTHON',
  '.ipynb': 'IPYTHON',
  '.java': 'JAVA',
  '.go': 'GO',
  '.php': 'PHP',
  '.html': 'HTML',
  '.htm': 'HTML',
  '.xml': 'XML',
  '.tf': 'TERRAFORM',
};

function detectLanguage(file) {
  return LANGUAGE_BY_EXTENSION[path.extname(file).toLowerCase()] || null;
}

const TEST_PATH =
  /(^|[\\/])(__tests__|tests?|spec)([\\/])|\.(test|spec)\.[^.]+$|(^|[\\/])test_[^\\/]+\.py$/i;

class SloopError extends Error {}

class Sloop {
  /**
   * @param {object} options
   * @param {object} options.manifest   install.json from provision.js
   * @param {string} options.root       project root (the configuration scope's base dir)
   * @param {string} options.storageDir SLOOP storage/work/home, under the data dir
   * @param {(line: string) => void} [options.onLog]
   * @param {(code: number|null) => void} [options.onExit]
   */
  constructor({ manifest, root, storageDir, onLog = () => {}, onExit = () => {} }) {
    this.manifest = manifest;
    this.root = root;
    this.storageDir = storageDir;
    this.onLog = onLog;
    this.onExit = onExit;
    this.files = new Map();
    this.logs = [];
    this.skippedLanguages = [];
    this.raised = new Map();
    this.child = null;
    this.connection = null;
    this.exited = Promise.resolve(null);
    this.stopping = false;
  }

  log(line) {
    const entry = `${new Date().toISOString()} ${line}`;
    this.logs.push(entry);
    if (this.logs.length > LOG_BUFFER) this.logs.shift();
    this.onLog(entry);
  }

  logsSince(index) {
    return this.logs.slice(index);
  }

  enabledLanguages() {
    return [...new Set(this.manifest.analyzers.flatMap((a) => a.languages))];
  }

  initializeParams() {
    const dir = (name) => {
      const full = path.join(this.storageDir, name);
      fs.mkdirSync(full, { recursive: true });
      return full;
    };
    return {
      clientConstantInfo: { name: CLIENT_NAME, userAgent: CLIENT_NAME },
      telemetryConstantAttributes: {
        productKey: 'claude-code-sonarqube',
        productName: CLIENT_NAME,
        productVersion: '0',
        ideVersion: '0',
        additionalAttributes: {},
      },
      httpConfiguration: {
        sslConfiguration: {},
        connectTimeout: 'PT5S',
        socketTimeout: 'PT5S',
        connectionRequestTimeout: 'PT5S',
        responseTimeout: 'PT5S',
      },
      // Empty on purpose: no TELEMETRY, no PROJECT_SYNCHRONIZATION, no
      // SERVER_SENT_EVENTS, no EMBEDDED_SERVER — nothing that opens a socket.
      backendCapabilities: [],
      storageRoot: dir('storage'),
      workDir: dir('work'),
      embeddedPluginPaths: this.manifest.analyzers.map((a) => a.path),
      connectedModeEmbeddedPluginPathsByKey: {},
      enabledLanguagesInStandaloneMode: this.enabledLanguages(),
      extraEnabledLanguagesInConnectedMode: [],
      disabledPluginKeysForAnalysis: [],
      sonarQubeConnections: [],
      sonarCloudConnections: [],
      sonarlintUserHome: dir('home'),
      standaloneRuleConfigByKey: {},
      isFocusOnNewCode: false,
      languageSpecificRequirements: {
        // The JS/TS analyzer unpacks its own bundle when bundlePath is null
        // (verified against 14.1.0); it only needs a Node >= 22.12 to run it.
        jsTsRequirements: { clientNodeJsPath: process.execPath, bundlePath: null },
        omnisharpDownloadEnabled: false,
      },
      automaticAnalysisEnabled: false,
      telemetryMigration: null,
      logLevel: 'INFO',
    };
  }

  /*
   * Spawns SLOOP, initializes it, registers the project as one configuration
   * scope, and resolves once SLOOP says the scope is ready for analysis.
   */
  async start({ readyTimeoutMs = 60_000 } = {}) {
    const { javaPath, backendDir, mainClass } = this.manifest;
    const classpath = path.join(backendDir, 'lib', '*');
    this.child = spawn(
      javaPath,
      ['-Xms128m', '-XX:+UseSerialGC', '-Djava.awt.headless=true', '-cp', classpath, mainClass],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      for (const line of chunk.split(/\r?\n/)) if (line.trim()) this.log(`[stderr] ${line}`);
    });

    const exited = new Promise((resolve) => {
      this.child.on('exit', (code) => {
        this.log(`SLOOP exited with code ${code}`);
        resolve(code);
        if (!this.stopping) this.onExit(code);
      });
      this.child.on('error', (error) => {
        this.log(`SLOOP failed to start: ${error.message}`);
        resolve(null);
        if (!this.stopping) this.onExit(null);
      });
    });

    this.connection = rpc.createMessageConnection(
      new rpc.StreamMessageReader(this.child.stdout),
      new rpc.StreamMessageWriter(this.child.stdin),
    );

    let markReady;
    const ready = new Promise((resolve) => {
      markReady = resolve;
    });
    this.registerCallbacks(markReady);
    this.connection.listen();

    this.exited = exited;
    const failOnExit = exited.then((code) => {
      throw new SloopError(`SLOOP exited during startup (code ${code}); see the daemon log`);
    });
    // Only ever awaited inside a race; once startup is over, SLOOP exiting is
    // onExit's business, not an unhandled rejection.
    failOnExit.catch(() => {});

    await Promise.race([
      this.connection.sendRequest('initialize', this.initializeParams()),
      failOnExit,
    ]);
    this.connection.sendNotification('configuration/didAddConfigurationScopes', {
      addedScopes: [
        {
          id: SCOPE_ID,
          parentId: null,
          bindable: false,
          name: path.basename(this.root),
          binding: null,
        },
      ],
    });
    await withTimeout(
      Promise.race([ready, failOnExit]),
      readyTimeoutMs,
      'SLOOP did not become ready for analysis',
    );
  }

  registerCallbacks(markReady) {
    const c = this.connection;

    c.onRequest('listFiles', () => ({ files: [...this.files.values()] }));
    c.onRequest('getBaseDir', () => ({ baseDir: this.root }));
    c.onRequest('getFileExclusions', () => ({ fileExclusionPatterns: [] }));
    c.onRequest('getInferredAnalysisProperties', () => ({ properties: {} }));
    c.onRequest('getClientLiveInfo', () => ({ description: CLIENT_NAME }));
    c.onRequest('getTelemetryLiveAttributes', () => ({}));
    c.onRequest('startProgress', () => null);
    c.onRequest('matchSonarProjectBranch', () => ({ matchedSonarBranch: null }));
    c.onRequest('matchProjectBranch', () => ({ isBranchMatched: true }));
    c.onRequest('getCredentials', () => null);
    c.onRequest('selectProxies', () => ({ proxies: [] }));
    c.onRequest('checkServerTrusted', () => ({ trusted: false }));
    c.onRequest('showMessageRequest', () => ({ selectedKey: null }));
    // Any request this client doesn't model gets a null result rather than
    // a method-not-found error that could wedge SLOOP's caller.
    c.onRequest((method) => {
      this.log(`unhandled request from SLOOP: ${method}`);
      return null;
    });

    c.onNotification('didChangeAnalysisReadiness', (params) => {
      if (params.areReadyForAnalysis && params.configurationScopeIds.includes(SCOPE_ID))
        markReady();
    });
    c.onNotification('raiseIssues', (params) => {
      if (params.analysisId && !params.isIntermediatePublication) {
        this.raised.set(params.analysisId, params.issuesByFileUri);
      }
    });
    c.onNotification('didSkipLoadingPlugin', (params) => {
      this.skippedLanguages.push({
        language: params.language,
        reason: params.reason,
        minVersion: params.minVersion,
      });
      this.log(`skipped ${params.language} analyzer: ${params.reason}`);
    });
    c.onNotification('log', (params) => {
      this.log(
        `[${params.level}] ${params.message}${params.stackTrace ? `\n${params.stackTrace}` : ''}`,
      );
    });
    c.onNotification('showMessage', (params) => this.log(`[message] ${params.message}`));
    c.onNotification(() => {});
  }

  fileDto({ abs, content }) {
    const rel = path.relative(this.root, abs);
    return {
      uri: pathToFileURL(abs).href,
      ideRelativePath: rel,
      configScopeId: SCOPE_ID,
      isTest: TEST_PATH.test(rel),
      charset: 'UTF-8',
      fsPath: abs,
      content,
      detectedLanguage: detectLanguage(abs),
      isUserDefined: true,
    };
  }

  /*
   * Registers (or refreshes) the given files with SLOOP, analyzes them, and
   * returns { issues, failed }. `entries` are { abs, content } — the caller
   * has already read and path-checked them.
   *
   * Issues come from the analyzeFilesAndTrack response's rawIssues, which are
   * scoped to exactly the files asked about. The raiseIssues notification for
   * the same analysisId is the fallback: it carries every issue known in the
   * scope, so it is filtered back down to the requested URIs.
   */
  async analyze(entries, { timeoutMs = 120_000 } = {}) {
    const added = [];
    const changed = [];
    const dtos = entries.map((entry) => this.fileDto(entry));
    for (const dto of dtos) {
      (this.files.has(dto.uri) ? changed : added).push(dto);
      this.files.set(dto.uri, dto);
    }
    this.connection.sendNotification('file/didUpdateFileSystem', {
      addedFiles: added,
      changedFiles: changed,
      removedFiles: [],
    });

    const analysisId = crypto.randomUUID();
    const uris = dtos.map((d) => d.uri);
    const cancel = new rpc.CancellationTokenSource();
    let response;
    try {
      response = await withTimeout(
        this.connection.sendRequest(
          'analysis/analyzeFilesAndTrack',
          {
            configurationScopeId: SCOPE_ID,
            analysisId,
            filesToAnalyze: uris,
            extraProperties: {},
            shouldFetchServerIssues: false,
          },
          cancel.token,
        ),
        timeoutMs,
        `analysis did not finish within ${Math.round(timeoutMs / 1000)}s`,
      );
    } catch (error) {
      cancel.cancel();
      throw error;
    } finally {
      cancel.dispose();
    }

    let issues = Array.isArray(response?.rawIssues) ? response.rawIssues : null;
    if (!issues) {
      const wanted = new Set(uris);
      const byUri = this.raised.get(analysisId) || {};
      issues = Object.entries(byUri)
        .filter(([uri]) => wanted.has(uri))
        .flatMap(([uri, list]) => list.map((issue) => ({ ...issue, fileUri: uri })));
    }
    this.raised.delete(analysisId);
    return { issues, failed: (response?.failedAnalysisFiles || []).map(String) };
  }

  /*
   * Drops files from SLOOP's view of the project (virtual stdin files, which
   * must not linger in listFiles once analyzed).
   */
  forget(absPaths) {
    const removed = absPaths
      .map((abs) => pathToFileURL(abs).href)
      .filter((uri) => this.files.delete(uri));
    if (removed.length) {
      this.connection.sendNotification('file/didUpdateFileSystem', {
        addedFiles: [],
        changedFiles: [],
        removedFiles: removed,
      });
    }
  }

  ruleDetails(ruleKey) {
    return this.connection.sendRequest('rule/getStandaloneRuleDetails', { ruleKey });
  }

  listRules() {
    return this.connection.sendRequest('rule/listAllStandaloneRulesDefinitions');
  }

  async stop() {
    this.stopping = true;
    if (!this.child || this.child.exitCode !== null) return;
    try {
      await withTimeout(this.connection.sendRequest('shutdown'), 5000, 'shutdown timed out');
    } catch {
      // fall through to closing stdin, which SLOOP also treats as "exit"
    }
    this.child.stdin.end();
    const killed = await Promise.race([
      this.exited.then(() => false),
      delay(5000).then(() => true),
    ]);
    if (killed) this.child.kill('SIGKILL');
    this.connection.dispose();
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

/*
 * Races `promise` against a timer that is always cleared, so a promise that
 * wins never leaves a stray rejection behind to crash the daemon later.
 */
function withTimeout(promise, ms, message) {
  let timer;
  const expiry = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new SloopError(message)), ms);
  });
  return Promise.race([promise, expiry]).finally(() => clearTimeout(timer));
}

module.exports = { Sloop, SloopError, detectLanguage, LANGUAGE_BY_EXTENSION, SCOPE_ID, TEST_PATH };
