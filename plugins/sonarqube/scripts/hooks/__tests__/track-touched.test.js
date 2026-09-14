'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, writeFile, runHook, uniqueSessionId } = require('./helpers');

function readTouched(pluginData, sessionId) {
  const listFile = path.join(pluginData, 'sonarqube-session-scope', sessionId, 'touched-files.txt');
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

test('tracks a file on Write', (t) => {
  const { scratch, pluginData, sessionId } = setup(t);
  const file = writeFile(scratch, 'src/app.js');

  const res = track(file, sessionId, scratch, pluginData, 'Write');

  assert.equal(res.status, 0);
  assert.deepEqual(readTouched(pluginData, sessionId), [file]);
});

test('tracks a file on Edit', (t) => {
  const { scratch, pluginData, sessionId } = setup(t);
  const file = writeFile(scratch, 'src/app.js');

  track(file, sessionId, scratch, pluginData, 'Edit');

  assert.deepEqual(readTouched(pluginData, sessionId), [file]);
});

test('tracks files of any type, not just known Sonar languages', (t) => {
  const { scratch, pluginData, sessionId } = setup(t);
  const env = writeFile(scratch, '.env', 'TOKEN=x\n');
  const tf = writeFile(scratch, 'infra/main.tf');
  const extensionless = writeFile(scratch, 'Dockerfile');

  track(env, sessionId, scratch, pluginData);
  track(tf, sessionId, scratch, pluginData);
  track(extensionless, sessionId, scratch, pluginData);

  assert.deepEqual(readTouched(pluginData, sessionId), [env, tf, extensionless]);
});

test('ignores dependency, VCS and build directories', (t) => {
  const { scratch, pluginData, sessionId } = setup(t);
  for (const relative of [
    'node_modules/left-pad/index.js',
    '.git/config',
    'dist/bundle.js',
    'coverage/lcov.info',
  ]) {
    track(writeFile(scratch, relative), sessionId, scratch, pluginData);
  }

  assert.deepEqual(readTouched(pluginData, sessionId), []);
});

test('ignores tool names other than Edit/Write', (t) => {
  const { scratch, pluginData, sessionId } = setup(t);
  const file = writeFile(scratch, 'src/app.js');

  track(file, sessionId, scratch, pluginData, 'Read');

  assert.deepEqual(readTouched(pluginData, sessionId), []);
});

test("ignores a file_path that doesn't exist on disk", (t) => {
  const { scratch, pluginData, sessionId } = setup(t);

  track(path.join(scratch, 'missing.js'), sessionId, scratch, pluginData);

  assert.deepEqual(readTouched(pluginData, sessionId), []);
});

test('resolves a relative file_path against the session cwd', (t) => {
  const { scratch, pluginData, sessionId } = setup(t);
  const file = writeFile(scratch, 'src/app.js');

  track('src/app.js', sessionId, scratch, pluginData);

  assert.deepEqual(readTouched(pluginData, sessionId), [file]);
});

test('dedups repeated writes to the same file', (t) => {
  const { scratch, pluginData, sessionId } = setup(t);
  const file = writeFile(scratch, 'src/app.js');

  track(file, sessionId, scratch, pluginData);
  track(file, sessionId, scratch, pluginData);

  assert.deepEqual(readTouched(pluginData, sessionId), [file]);
});

test('keeps separate sessions apart', (t) => {
  const { scratch, pluginData, sessionId } = setup(t);
  const other = uniqueSessionId();
  const a = writeFile(scratch, 'a.js');
  const b = writeFile(scratch, 'b.js');

  track(a, sessionId, scratch, pluginData);
  track(b, other, scratch, pluginData);

  assert.deepEqual(readTouched(pluginData, sessionId), [a]);
  assert.deepEqual(readTouched(pluginData, other), [b]);
});
