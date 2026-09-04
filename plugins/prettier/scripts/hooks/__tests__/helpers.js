'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const HOOKS_DIR = path.join(__dirname, '..');

/*
Repo root — five levels up from scripts/hooks/__tests__/. Scratch dirs
live under here (not os.tmpdir()) so that when the hook shells out to
`npx prettier`, npx's local-bin lookup walks up and finds this repo's
own root-level `prettier` devDependency instead of needing network
access to resolve it from the registry.
*/
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const SCRATCH_ROOT = path.join(REPO_ROOT, '.scratch');

function mkScratchDir(prefix = 'prettier-plugin-test-') {
  fs.mkdirSync(SCRATCH_ROOT, { recursive: true });
  return fs.mkdtempSync(path.join(SCRATCH_ROOT, prefix));
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
Runs one of the plugin's hook scripts the same way Claude Code does:
stdin gets the hook's JSON payload, stdout is parsed as JSON when present.
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
  runHook,
  HOOKS_DIR,
};
