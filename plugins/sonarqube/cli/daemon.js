#!/usr/bin/env node
'use strict';

/*
 * The per-project analysis daemon. Owns one warm SLOOP process for one
 * project root and serves analysis requests from the `sonarlint` CLI over a
 * Unix socket (a named pipe on Windows).
 *
 * Why a daemon at all: starting the JVM, loading nine analyzers and spinning
 * up the JS/TS bridge costs ~20s, a warm analysis ~2s. A hook that paid the
 * cold cost on every edit would be unusable.
 *
 *   node daemon.js --root <dir> --data-dir <dir> [--idle-minutes N] [--warm]
 *
 * Lifecycle: started on demand by the CLI (detached), exits after an idle
 * timeout, on `daemon stop`, or on SIGTERM. Runs one analysis at a time —
 * SLOOP's configuration scope is shared state — and queues the rest. If SLOOP
 * dies it is restarted once; a second death fails every request (exit 2 at
 * the CLI) and the daemon exits.
 *
 * Wire protocol: one newline-terminated JSON request per connection, one
 * newline-terminated JSON response. Requests never carry credentials, and
 * nothing here makes a network call.
 */

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { Sloop } = require('./sloop');
const { resolveInside } = require('./fs-guard');
const { daemonPaths, ensurePrivateDir, writePrivateFile } = require('./paths');
const { readInstall } = require('./provision');

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const WARMUP_FILES = [
  ['.sonarlint-warmup.js', 'export const warm = 1;\n'],
  ['.sonarlint-warmup.py', 'warm = 1\n'],
];

function parseArgv(argv) {
  const options = { root: null, dataDir: null, idleMinutes: 30, warm: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') options.root = argv[++i];
    else if (arg === '--data-dir') options.dataDir = argv[++i];
    else if (arg === '--idle-minutes') options.idleMinutes = Number(argv[++i]);
    else if (arg === '--warm') options.warm = true;
  }
  if (!options.root || !options.dataDir) throw new Error('daemon needs --root and --data-dir');
  if (!Number.isFinite(options.idleMinutes) || options.idleMinutes <= 0) options.idleMinutes = 30;
  return options;
}

class Daemon {
  constructor({ root, dataDir, idleMinutes, warm }) {
    this.root = fs.realpathSync(root);
    this.dataDir = dataDir;
    this.idleMs = idleMinutes * 60_000;
    this.warm = warm;
    this.paths = daemonPaths(this.root);
    this.state = 'starting';
    this.error = null;
    this.restarts = 0;
    this.analyses = 0;
    this.startedAt = new Date().toISOString();
    this.queue = Promise.resolve();
    this.sloop = null;
    this.ready = null;
    this.server = null;
    this.idleTimer = null;
    this.logStream = null;
    this.shuttingDown = false;
  }

  log(line) {
    this.logStream?.write(`${line}\n`);
  }

  async run() {
    ensurePrivateDir(this.paths.dir);
    writePrivateFile(this.paths.log, '');
    this.logStream = fs.createWriteStream(this.paths.log, { flags: 'a', mode: 0o600 });

    this.manifest = readInstall(this.dataDir);
    if (!this.manifest) throw new Error(`SLOOP is not installed in ${this.dataDir}`);

    await this.listen();
    writePrivateFile(this.paths.pid, `${process.pid}\n`);
    this.log(`daemon ${process.pid} serving ${this.root} on ${this.paths.socket}`);

    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    this.touch();

    this.ready = this.startSloop();
    this.ready.catch(() => {});
    if (this.warm) {
      this.enqueue(() => this.warmUp()).catch((error) =>
        this.log(`warm-up failed: ${error.message}`),
      );
    }
  }

  async startSloop() {
    this.state = 'starting';
    const sloop = new Sloop({
      manifest: this.manifest,
      root: this.root,
      storageDir: path.join(this.dataDir, 'storage', this.paths.hash),
      onLog: (line) => this.log(line),
      onExit: (code) => this.onSloopExit(code),
    });
    this.sloop = sloop;
    try {
      await sloop.start();
      this.state = 'ready';
      this.log('SLOOP ready');
    } catch (error) {
      this.state = 'failed';
      this.error = error.message;
      this.log(`SLOOP failed to start: ${error.message}`);
      throw error;
    }
  }

  /*
   * One restart, then give up: a SLOOP that keeps dying is a broken install
   * or an analyzer crash, and retrying it forever would just burn CPU in the
   * background of somebody's session.
   */
  onSloopExit(code) {
    if (this.shuttingDown) return;
    if (this.restarts >= 1) {
      this.state = 'failed';
      this.error = `SLOOP exited (code ${code}) after a restart; see ${this.paths.log}`;
      this.log(this.error);
      // Leave a marker so the next CLI call fails fast (exit 2) instead of
      // quietly paying for a fresh daemon that will most likely crash too.
      writePrivateFile(this.paths.failed, `${new Date().toISOString()} ${this.error}\n`);
      setTimeout(() => this.shutdown('SLOOP crashed twice'), 1000).unref();
      return;
    }
    this.restarts += 1;
    this.log(`SLOOP exited (code ${code}); restarting once`);
    this.ready = this.startSloop();
    this.ready.catch(() => {});
  }

  listen() {
    return new Promise((resolve, reject) => {
      const server = net.createServer({ allowHalfOpen: true }, (socket) =>
        this.onConnection(socket),
      );
      server.once('error', (error) => {
        if (error.code !== 'EADDRINUSE' || process.platform === 'win32') return reject(error);
        // A socket file with nobody behind it is left over from a daemon that
        // died; one that answers belongs to a live daemon we must not steal.
        const probe = net.connect(this.paths.socket);
        probe.once('connect', () => {
          probe.destroy();
          reject(new Error('another daemon is already serving this project'));
        });
        probe.once('error', () => {
          fs.rmSync(this.paths.socket, { force: true });
          server.once('error', reject);
          server.listen(this.paths.socket, () => {
            fs.chmodSync(this.paths.socket, 0o600);
            resolve();
          });
        });
      });
      server.listen(this.paths.socket, () => {
        if (process.platform !== 'win32') fs.chmodSync(this.paths.socket, 0o600);
        resolve();
      });
      this.server = server;
    });
  }

  onConnection(socket) {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > MAX_REQUEST_BYTES) {
        socket.end(`${JSON.stringify({ ok: false, error: 'request too large' })}\n`);
        socket.destroy();
        return;
      }
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const line = buffer.slice(0, newline);
      buffer = '';
      this.handle(line)
        .then((response) => socket.end(`${JSON.stringify(response)}\n`))
        .catch((error) => socket.end(`${JSON.stringify({ ok: false, error: error.message })}\n`));
    });
    socket.on('error', () => {});
  }

  async handle(line) {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      return { ok: false, error: 'malformed request' };
    }
    this.touch();
    try {
      switch (request.op) {
        case 'status':
          return { ok: true, ...this.status() };
        case 'stop':
          setImmediate(() => this.shutdown('stop requested'));
          return { ok: true, stopping: true };
        case 'analyze':
          return { ok: true, ...(await this.enqueue(() => this.analyze(request))) };
        case 'rules':
          return { ok: true, ...(await this.enqueue(() => this.rules(request))) };
        default:
          return { ok: false, error: `unknown op "${request.op}"` };
      }
    } finally {
      this.touch();
    }
  }

  status() {
    return {
      pid: process.pid,
      root: this.root,
      state: this.state,
      error: this.error,
      startedAt: this.startedAt,
      analyses: this.analyses,
      restarts: this.restarts,
      backendVersion: this.manifest?.backendVersion,
      skippedLanguages: this.sloop?.skippedLanguages || [],
      idleMinutes: this.idleMs / 60_000,
      log: this.paths.log,
    };
  }

  enqueue(task) {
    const run = this.queue.then(async () => {
      await this.ready;
      if (this.state !== 'ready') throw new Error(this.error || 'SLOOP is not ready');
      return task();
    });
    this.queue = run.catch(() => {});
    return run;
  }

  /*
   * Reads each requested file through the project-root guard, hands the
   * survivors to SLOOP, and reports what was skipped and why. A virtual file
   * (stdin analysis) is analyzed from the content in the request and
   * forgotten again afterwards, so it never shows up in a later listFiles.
   */
  async analyze({ files = [], virtual = null, timeoutMs, verbose }) {
    const entries = [];
    const skipped = [];
    for (const requested of files) {
      const guard = resolveInside(this.root, requested);
      if (!guard.ok) {
        skipped.push({ file: guard.abs, reason: guard.reason });
        continue;
      }
      entries.push({ abs: guard.abs, content: fs.readFileSync(guard.abs, 'utf8') });
    }

    let virtualAbs = null;
    if (virtual) {
      const guard = resolveInside(this.root, virtual.path, { mustExist: false });
      if (!guard.ok) throw new Error(`--path ${virtual.path}: ${guard.reason}`);
      virtualAbs = guard.abs;
      entries.push({ abs: virtualAbs, content: String(virtual.content) });
    }

    const logMark = this.sloop.logs.length;
    let result = { issues: [], failed: [] };
    try {
      if (entries.length) result = await this.sloop.analyze(entries, { timeoutMs });
    } finally {
      if (virtualAbs) this.sloop.forget([virtualAbs]);
    }
    this.analyses += 1;

    return {
      root: this.root,
      issues: result.issues,
      analyzed: entries.map((e) => e.abs),
      failed: result.failed,
      skipped,
      skippedLanguages: this.sloop.skippedLanguages,
      ...(verbose ? { logs: this.sloop.logsSince(logMark) } : {}),
    };
  }

  async rules({ key, search, lang }) {
    if (key) {
      return { rule: await this.sloop.ruleDetails(key) };
    }
    const { rulesByKey } = await this.sloop.listRules();
    const needle = search ? String(search).toLowerCase() : null;
    const rules = Object.values(rulesByKey)
      .filter((r) => !lang || r.language === lang)
      .filter(
        (r) =>
          !needle || r.key.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle),
      )
      .map((r) => ({
        key: r.key,
        name: r.name,
        language: r.language,
        impacts: r.softwareImpacts,
        activeByDefault: r.isActiveByDefault,
      }))
      .sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
    return { rules };
  }

  /*
   * The JS/TS bridge and the Python front end are lazily started by SLOOP on
   * their first analysis, which is most of the ~20s cold cost. Analyzing two
   * throwaway virtual files right after start moves that cost off the first
   * real request.
   */
  async warmUp() {
    for (const [name, content] of WARMUP_FILES) {
      await this.analyze({ virtual: { path: name, content }, timeoutMs: 120_000 });
    }
    this.analyses = 0;
    this.log('warm-up done');
  }

  touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.shutdown('idle timeout'), this.idleMs);
    this.idleTimer.unref();
  }

  async shutdown(reason) {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.log(`shutting down: ${reason}`);
    clearTimeout(this.idleTimer);
    this.server?.close();
    try {
      await this.sloop?.stop();
    } catch (error) {
      this.log(`error stopping SLOOP: ${error.message}`);
    }
    if (process.platform !== 'win32') fs.rmSync(this.paths.socket, { force: true });
    try {
      if (fs.readFileSync(this.paths.pid, 'utf8').trim() === String(process.pid))
        fs.rmSync(this.paths.pid);
    } catch {
      // already gone
    }
    this.logStream?.end(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  }
}

async function main() {
  const daemon = new Daemon(parseArgv(process.argv.slice(2)));
  try {
    await daemon.run();
  } catch (error) {
    daemon.log(`daemon failed: ${error.message}`);
    process.stderr.write(`sonarlint daemon: ${error.message}\n`);
    process.exit(2);
  }
}

if (require.main === module) {
  // main() handles failures of run() itself; this catches what throws before
  // it (a bad argv), which would otherwise be an unhandled rejection.
  main().catch((error) => {
    process.stderr.write(`sonarlint daemon: ${error.message}\n`);
    process.exit(2);
  });
}

module.exports = { Daemon, parseArgv };
