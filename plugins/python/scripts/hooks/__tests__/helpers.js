'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { resolveTool } = require('../lib');

const HOOKS_DIR = path.join(__dirname, '..');

function mkScratchDir(prefix = 'py-plugin-test-') {
  /*
  realpath: on macOS os.tmpdir() sits behind a /var -> /private/var
  symlink, and ruff/pyright report the resolved path.
  */
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
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
  const result = spawnSync(process.execPath, [scriptPath], {
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
Fires the PostToolUse tracking hook for one tool call, the way Claude Code
does after an Edit/Write. `ctx` is a test's { scratch, pluginData,
sessionId }.
*/
function track(file, { scratch, pluginData, sessionId }, toolName = 'Write') {
  return runHook(
    'track-touched.js',
    { tool_name: toolName, tool_input: { file_path: file }, session_id: sessionId, cwd: scratch },
    { env: { CLAUDE_PLUGIN_DATA: pluginData } },
  );
}

/*
The integration suites need a real ruff. CI installs one, so there a
missing ruff must fail loudly; on a dev machine without it, the
ruff-dependent tests skip instead of failing for an environmental reason.
*/
const RUFF_AVAILABLE = resolveTool('ruff') !== null;
const SKIP_WITHOUT_RUFF = !RUFF_AVAILABLE && !process.env.CI ? 'ruff is not installed' : false;

module.exports = {
  mkScratchDir,
  rmScratchDir,
  uniqueSessionId,
  runHook,
  track,
  HOOKS_DIR,
  SKIP_WITHOUT_RUFF,
};
