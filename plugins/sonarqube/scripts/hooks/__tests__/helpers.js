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
 *
 * Spawns process.execPath rather than a bare `node`, so a test is free to
 * hand the hook a PATH that contains no toolchain at all — which is exactly
 * what the "sonar isn't installed" case needs.
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
 * The hooks shell out to the real `sonar` CLI, which is a prerequisite this
 * repository deliberately does not install (see the plugin README). Requiring
 * it in CI would make the suite untestable everywhere it isn't present, so
 * instead drop a stand-in executable into a directory that gets prepended to
 * the hook's PATH — the same technique ad-lfl-kit's own exec suite uses to
 * exercise `resolveBin`'s extraDirs.
 *
 * `spec` maps a stage ("secrets" or "analysis") to { status, stdout, stderr }.
 * The stand-in also appends every invocation to a log file as JSON lines, so
 * tests can assert on the argv and cwd it was called with — that is the only
 * way to prove `--project`, `--depth` and per-group cwd are wired correctly.
 */
function installFakeSonar(scratch, spec = {}) {
  const binDir = path.join(scratch, 'fake-bin');
  const logFile = path.join(scratch, 'sonar-invocations.jsonl');
  const specFile = path.join(scratch, 'sonar-spec.json');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(specFile, JSON.stringify(spec));

  const script = `#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const argv = process.argv.slice(2);
const spec = JSON.parse(fs.readFileSync(${JSON.stringify(specFile)}, 'utf8'));
const stage = argv[1] === 'secrets' ? 'secrets' : 'analysis';
fs.appendFileSync(
  ${JSON.stringify(logFile)},
  JSON.stringify({ stage, argv, cwd: process.cwd() }) + '\\n',
);
const outcome = spec[stage] || { status: 0 };
if (outcome.stdout) process.stdout.write(outcome.stdout);
if (outcome.stderr) process.stderr.write(outcome.stderr);
process.exit(outcome.status || 0);
`;

  const binPath = path.join(binDir, 'sonar');
  fs.writeFileSync(binPath, script);
  fs.chmodSync(binPath, 0o755);

  return { binDir, logFile, binPath };
}

function readInvocations(logFile) {
  if (!fs.existsSync(logFile)) return [];
  return fs
    .readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/*
 * An environment in which `sonar` resolves to the fake. binDir is PREPENDED
 * rather than replacing PATH: sonar.js preserves PATH order and resolveBin
 * takes the first hit, so the fake still wins over a real CLI, and the rest
 * of the toolchain (the fake's own `#!/usr/bin/env node`) keeps working.
 * HOME is redirected into the scratch dir so sonar.js's ~/.local/bin-style
 * fallbacks can't reach a real install either.
 */
function fakeSonarEnv(scratch, binDir, extra = {}) {
  return {
    PATH: [binDir, process.env.PATH].filter(Boolean).join(path.delimiter),
    HOME: path.join(scratch, 'home'),
    ...extra,
  };
}

/*
 * An environment in which `sonar` resolves to nothing: an empty PATH and a
 * HOME with none of the fallback shim directories under it.
 */
function noSonarEnv(scratch) {
  const emptyBin = path.join(scratch, 'empty-bin');
  fs.mkdirSync(emptyBin, { recursive: true });
  return { PATH: emptyBin, HOME: path.join(scratch, 'home') };
}

/*
 * Prepends the fake `sonar` bin dir onto the *current process*'s PATH — for
 * tests that call sonar.js's functions in-process rather than through
 * runHook, so resolveBin sees the fake without a child process to hand an
 * env object to. Restores the original PATH on test teardown.
 */
function useFakeSonarPath(t, binDir) {
  const originalPath = process.env.PATH;
  t.after(() => {
    process.env.PATH = originalPath;
  });
  process.env.PATH = [binDir, originalPath].filter(Boolean).join(path.delimiter);
}

/*
 * sonar.js also probes two fixed system locations, which no environment
 * variable can redirect. A developer machine with the real CLI installed
 * there cannot exercise the "sonar is missing" path, so those tests declare
 * themselves skipped rather than reporting a false failure. CI has neither.
 */
const SYSTEM_SONAR_PATHS = ['/opt/homebrew/bin/sonar', '/usr/local/bin/sonar'];

function systemSonarInstalled() {
  return SYSTEM_SONAR_PATHS.some((candidate) => fs.existsSync(candidate));
}

module.exports = {
  HOOKS_DIR,
  mkScratchDir,
  rmScratchDir,
  uniqueSessionId,
  setup,
  writeFile,
  runHook,
  installFakeSonar,
  readInvocations,
  fakeSonarEnv,
  noSonarEnv,
  useFakeSonarPath,
  systemSonarInstalled,
};
