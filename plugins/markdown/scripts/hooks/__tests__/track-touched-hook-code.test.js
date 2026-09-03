'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchDir, rmScratchDir, uniqueSessionId, runHook, HOOKS_DIR } = require('./helpers');

function track(filePath, sessionId, pluginData) {
  return runHook(
    'track-touched-hook-code.js',
    {
      tool_name: 'Edit',
      tool_input: { file_path: filePath },
      session_id: sessionId,
      cwd: HOOKS_DIR,
    },
    { env: { CLAUDE_PLUGIN_DATA: pluginData } },
  );
}

function listFileFor(pluginData, sessionId) {
  return path.join(pluginData, 'markdown-session-scope', sessionId, 'touched-hook-code.txt');
}

test('a .js file inside scripts/hooks/ is tracked', (t) => {
  const pluginData = mkScratchDir();
  t.after(() => rmScratchDir(pluginData));
  const sessionId = uniqueSessionId();

  // lib.js is real and already exists — read-only for this hook, never
  // written to, so it's safe to reference from a test.
  const libFile = path.join(HOOKS_DIR, 'lib.js');
  track(libFile, sessionId, pluginData);

  const contents = fs.readFileSync(listFileFor(pluginData, sessionId), 'utf8');
  assert.ok(contents.includes(libFile));
});

test('a .js file outside scripts/hooks/ is ignored', (t) => {
  const pluginData = mkScratchDir();
  t.after(() => rmScratchDir(pluginData));
  const sessionId = uniqueSessionId();
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const outsideFile = path.join(scratch, 'outside.js');
  fs.writeFileSync(outsideFile, '// not a hook\n');

  track(outsideFile, sessionId, pluginData);

  assert.equal(fs.existsSync(listFileFor(pluginData, sessionId)), false);
});

test('a non-.js file inside scripts/hooks/ is ignored', (t) => {
  const pluginData = mkScratchDir();
  t.after(() => rmScratchDir(pluginData));
  const sessionId = uniqueSessionId();

  const readme = path.join(path.dirname(HOOKS_DIR), '..', 'README.md');
  track(readme, sessionId, pluginData);

  assert.equal(fs.existsSync(listFileFor(pluginData, sessionId)), false);
});

test('dedups repeated edits to the same file', (t) => {
  const pluginData = mkScratchDir();
  t.after(() => rmScratchDir(pluginData));
  const sessionId = uniqueSessionId();
  const libFile = path.join(HOOKS_DIR, 'lib.js');

  track(libFile, sessionId, pluginData);
  track(libFile, sessionId, pluginData);

  const lines = fs
    .readFileSync(listFileFor(pluginData, sessionId), 'utf8')
    .split('\n')
    .filter(Boolean);
  assert.equal(lines.length, 1);
});

test('ignores tool names other than Edit/Write', (t) => {
  const pluginData = mkScratchDir();
  t.after(() => rmScratchDir(pluginData));
  const sessionId = uniqueSessionId();
  const libFile = path.join(HOOKS_DIR, 'lib.js');

  const res = runHook(
    'track-touched-hook-code.js',
    {
      tool_name: 'Read',
      tool_input: { file_path: libFile },
      session_id: sessionId,
      cwd: HOOKS_DIR,
    },
    { env: { CLAUDE_PLUGIN_DATA: pluginData } },
  );

  assert.equal(res.status, 0);
  assert.equal(fs.existsSync(listFileFor(pluginData, sessionId)), false);
});
