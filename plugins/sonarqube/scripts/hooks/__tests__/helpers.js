'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const HOOKS_DIR = path.join(__dirname, '..');

function mkScratchDir(prefix = 'sonar-plugin-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmScratchDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

function uniqueSessionId() {
  return `test-${crypto.randomUUID()}`;
}

/*
 * Shared scratch-dir + plugin-data + session-id triple every hook-integration
 * test starts from, whichever hook it is exercising.
 */
function setup(t) {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  return { scratch, pluginData: path.join(scratch, 'plugin-data'), sessionId: uniqueSessionId() };
}

function writeFile(scratch, relative, contents = 'x\n') {
  const full = path.join(scratch, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

/*
 * Runs one of the plugin's hook scripts the same way Claude Code does: stdin
 * gets the hook's JSON payload, stdout is parsed as JSON when present.
 */
function runHook(scriptName, stdinObj, { env = {} } = {}) {
  const result = spawnSync(process.execPath, [path.join(HOOKS_DIR, scriptName)], {
    input: JSON.stringify(stdinObj),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });

  let json;
  const trimmed = (result.stdout || '').trim();
  if (trimmed) {
    try {
      json = JSON.parse(trimmed);
    } catch {
      json = undefined;
    }
  }

  return { ...result, json };
}

/*
 * The hooks run the plugin's own `sonarlint` CLI, which needs a SLOOP install
 * (hundreds of MB, a JVM) that a unit suite shouldn't depend on — the real
 * thing is covered by cli/__tests__/integration.test.js. So the hooks are
 * pointed at a stand-in through SONARLINT_CLI: a node script that logs its
 * argv and cwd and answers from a spec file.
 *
 * `spec.files` is { status, issues, skipped, skippedAnalyzers, stderr }, the
 * shape `sonarlint files --format json` prints; `spec.daemon` is
 * { status, stderr }. Issue `file`s are relative to the hook's cwd, as the
 * real CLI prints them.
 */
function installFakeSonarlint(scratch, spec = {}) {
  const logFile = path.join(scratch, 'sonarlint-invocations.jsonl');
  const specFile = path.join(scratch, 'sonarlint-spec.json');
  const script = path.join(scratch, 'fake-sonarlint.js');
  writeSpec(specFile, spec);
  fs.writeFileSync(
    script,
    `'use strict';
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(logFile)}, JSON.stringify({ argv, cwd: process.cwd() }) + '\\n');
const spec = JSON.parse(fs.readFileSync(${JSON.stringify(specFile)}, 'utf8'));
const outcome = spec[argv[0]] || {};
if (outcome.stderr) process.stderr.write(outcome.stderr);
if (argv[0] === 'files' && outcome.status !== 2) {
  const issues = outcome.issues || [];
  process.stdout.write(JSON.stringify({
    issues,
    summary: { analyzed: 1, clean: 0, withIssues: issues.length ? 1 : 0, atOrAboveThreshold: 0, minSeverity: 'INFO' },
    skipped: outcome.skipped || [],
    failed: [],
    ...(outcome.skippedAnalyzers ? { skippedAnalyzers: outcome.skippedAnalyzers } : {}),
  }));
}
process.exit(outcome.status === undefined ? (outcome.issues && outcome.issues.length ? 1 : 0) : outcome.status);
`,
  );
  return { script, logFile, specFile, env: { SONARLINT_CLI: script } };
}

function writeSpec(specFile, spec) {
  fs.writeFileSync(specFile, JSON.stringify(spec));
}

function readInvocations(logFile) {
  if (!fs.existsSync(logFile)) return [];
  return fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function issue(file, rule, severity, line = 1, extra = {}) {
  return {
    file,
    line,
    endLine: line,
    rule,
    severity,
    type: 'CODE_SMELL',
    message: `${rule} message`,
    hasQuickFix: false,
    ...extra,
  };
}

/*
 * A git repository with one committed file, for the tests that need line
 * scoping against HEAD to mean something.
 */
function gitRepo(dir) {
  const git = (...args) =>
    spawnSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
    });
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'test');
  git('config', 'commit.gpgsign', 'false');
  return { git, commitAll: () => (git('add', '-A'), git('commit', '-q', '-m', 'init')) };
}

module.exports = {
  HOOKS_DIR,
  mkScratchDir,
  rmScratchDir,
  uniqueSessionId,
  setup,
  writeFile,
  runHook,
  installFakeSonarlint,
  writeSpec,
  readInvocations,
  issue,
  gitRepo,
};
