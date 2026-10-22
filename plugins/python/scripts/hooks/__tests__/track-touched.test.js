'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchDir, rmScratchDir, uniqueSessionId, runHook } = require('./helpers');

function readTouched(pluginData, sessionId) {
  const listFile = path.join(pluginData, 'python-session-scope', sessionId, 'touched-files.txt');
  if (!fs.existsSync(listFile)) return [];
  return fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean);
}

function track(file, sessionId, scratch, pluginData, toolName = 'Write') {
  return runHook(
    'track-touched.js',
    {
      tool_name: toolName,
      tool_input: { file_path: file },
      session_id: sessionId,
      cwd: scratch,
    },
    { env: { CLAUDE_PLUGIN_DATA: pluginData } },
  );
}

function setup(t) {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  return { scratch, pluginData: path.join(scratch, 'plugin-data'), sessionId: uniqueSessionId() };
}

test('tracks a real .py file on Write', (t) => {
  const { scratch, pluginData, sessionId } = setup(t);
  const file = path.join(scratch, 'mod.py');
  fs.writeFileSync(file, 'x = 1\n');

  const res = track(file, sessionId, scratch, pluginData, 'Write');

  assert.equal(res.status, 0);
  assert.deepEqual(readTouched(pluginData, sessionId), [file]);
});

test('tracks a real .pyi stub on Edit', (t) => {
  const { scratch, pluginData, sessionId } = setup(t);
  const file = path.join(scratch, 'mod.pyi');
  fs.writeFileSync(file, 'x: int\n');

  const res = track(file, sessionId, scratch, pluginData, 'Edit');

  assert.equal(res.status, 0);
  assert.deepEqual(readTouched(pluginData, sessionId), [file]);
});

test('resolves a relative file_path against the session cwd', (t) => {
  const { scratch, pluginData, sessionId } = setup(t);
  const file = path.join(scratch, 'mod.py');
  fs.writeFileSync(file, 'x = 1\n');

  track('mod.py', sessionId, scratch, pluginData);

  assert.deepEqual(readTouched(pluginData, sessionId), [file]);
});

test('ignores non-Python files', (t) => {
  const { scratch, pluginData, sessionId } = setup(t);
  const file = path.join(scratch, 'notes.txt');
  fs.writeFileSync(file, 'hello\n');

  track(file, sessionId, scratch, pluginData);

  assert.deepEqual(readTouched(pluginData, sessionId), []);
});

test('ignores Python files inside a virtualenv', (t) => {
  const { scratch, pluginData, sessionId } = setup(t);
  const dir = path.join(scratch, '.venv', 'lib', 'site-packages', 'pkg');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'mod.py');
  fs.writeFileSync(file, 'x = 1\n');

  track(file, sessionId, scratch, pluginData);

  assert.deepEqual(readTouched(pluginData, sessionId), []);
});

test('ignores tool names other than Edit/Write', (t) => {
  const { scratch, pluginData, sessionId } = setup(t);
  const file = path.join(scratch, 'mod.py');
  fs.writeFileSync(file, 'x = 1\n');

  track(file, sessionId, scratch, pluginData, 'Read');

  assert.deepEqual(readTouched(pluginData, sessionId), []);
});

test("ignores a file_path that doesn't exist on disk", (t) => {
  const { scratch, pluginData, sessionId } = setup(t);

  track(path.join(scratch, 'missing.py'), sessionId, scratch, pluginData);

  assert.deepEqual(readTouched(pluginData, sessionId), []);
});

test('dedups repeated writes to the same file', (t) => {
  const { scratch, pluginData, sessionId } = setup(t);
  const file = path.join(scratch, 'mod.py');
  fs.writeFileSync(file, 'x = 1\n');

  track(file, sessionId, scratch, pluginData);
  track(file, sessionId, scratch, pluginData);

  assert.deepEqual(readTouched(pluginData, sessionId), [file]);
});
