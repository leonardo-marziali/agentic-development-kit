'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

// Under os.tmpdir(), so no .editorconfig from this repository sits above it.
function scratchDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'editorconfig-plugin-test-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function newSession(t) {
  const dir = scratchDir(t);
  const project = path.join(dir, 'project');
  fs.mkdirSync(project);
  return {
    project,
    pluginData: path.join(dir, 'plugin-data'),
    sessionId: `test-${crypto.randomUUID()}`,
  };
}

// Runs a hook script the way Claude Code does: JSON on stdin, JSON on stdout if any.
function runHook(script, session, payload, env = {}) {
  const result = spawnSync('node', [path.join(__dirname, '..', script)], {
    input: JSON.stringify({ session_id: session.sessionId, cwd: session.project, ...payload }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_DATA: session.pluginData, ...env },
  });
  const stdout = (result.stdout || '').trim();
  return { ...result, json: stdout ? JSON.parse(stdout) : undefined };
}

function touch(session, file) {
  return runHook('track-touched.js', session, {
    tool_name: 'Write',
    tool_input: { file_path: file },
  });
}

module.exports = { scratchDir, newSession, runHook, touch };
