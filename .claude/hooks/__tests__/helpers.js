'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const HOOKS_DIR = path.join(__dirname, '..');

function mkScratchDir(prefix = 'adk-repo-hooks-test-') {
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
Builds a throwaway plugin tree shaped exactly like a real one —
<root>/plugins/<name>/scripts/hooks/ with a package.json at the plugin
root — so the hooks' plugin-hooks path matching and their `pnpm test`
invocation are both exercised for real, without recursively re-running an
actual (much slower) plugin suite.
*/
function makeFixturePlugin(passing, name = 'fixture-plugin') {
  const root = mkScratchDir('adk-fixture-repo-');
  const pluginRoot = path.join(root, 'plugins', name);
  const hooksDir = path.join(pluginRoot, 'scripts', 'hooks');
  fs.mkdirSync(hooksDir, { recursive: true });

  fs.writeFileSync(
    path.join(pluginRoot, 'package.json'),
    JSON.stringify({ name, private: true, scripts: { test: 'node run-test.js' } }),
  );
  fs.writeFileSync(path.join(pluginRoot, 'status.txt'), passing ? '0' : '1');
  fs.writeFileSync(
    path.join(pluginRoot, 'run-test.js'),
    "process.exit(parseInt(require('fs').readFileSync('status.txt', 'utf8'), 10));\n",
  );

  const hookFile = path.join(hooksDir, 'dummy.js');
  fs.writeFileSync(hookFile, '// tracked hook file stand-in\n');

  return { root, pluginRoot, hooksDir, hookFile };
}

function setFixturePassing(pluginRoot, passing) {
  fs.writeFileSync(path.join(pluginRoot, 'status.txt'), passing ? '0' : '1');
}

function stateDirFor(stateRoot, sessionId) {
  return path.join(stateRoot, sessionId);
}

function seedTouched(stateRoot, sessionId, filePaths) {
  const dir = stateDirFor(stateRoot, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'touched-hook-code.txt'), [].concat(filePaths).join('\n') + '\n');
}

/*
Runs one of the repo's hook scripts the same way Claude Code does: stdin
gets the hook's JSON payload, stdout is parsed as JSON when present.
*/
function runHook(scriptName, stdinObj, { env = {} } = {}) {
  const scriptPath = path.join(HOOKS_DIR, scriptName);
  const result = spawnSync('node', [scriptPath], {
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

module.exports = {
  mkScratchDir,
  rmScratchDir,
  uniqueSessionId,
  makeFixturePlugin,
  setFixturePassing,
  stateDirFor,
  seedTouched,
  runHook,
  HOOKS_DIR,
};
