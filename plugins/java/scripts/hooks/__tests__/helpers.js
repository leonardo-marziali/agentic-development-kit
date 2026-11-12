'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const HOOKS_DIR = path.join(__dirname, '..');

function mkScratchDir(prefix = 'java-plugin-test-') {
  /*
  realpath: on macOS os.tmpdir() sits behind a /var -> /private/var
  symlink, and git and the JVM tools report the resolved path.
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

// Writes `files` ({ relPath: content }) under `root`, creating directories.
function writeTree(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
}

// A scratch git repository with one commit, so git-based scoping works.
function initRepo(root) {
  const git = (...args) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...GIT_ENV } });
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  return git;
}

const GIT_ENV = {
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

module.exports = {
  mkScratchDir,
  rmScratchDir,
  uniqueSessionId,
  runHook,
  track,
  writeTree,
  initRepo,
  HOOKS_DIR,
};
