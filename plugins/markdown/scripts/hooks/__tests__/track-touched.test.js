'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchDir, rmScratchDir, uniqueSessionId, runHook } = require('./helpers');

function readTouched(pluginData, sessionId) {
  const listFile = path.join(pluginData, 'markdown-session-scope', sessionId, 'touched-files.txt');
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

test('tracks a real .md file on Write', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();
  const file = path.join(scratch, 'doc.md');
  fs.writeFileSync(file, '# Doc\n');

  const res = track(file, sessionId, scratch, pluginData, 'Write');

  assert.equal(res.status, 0);
  assert.deepEqual(readTouched(pluginData, sessionId), [file]);
});

test('tracks a real .md file on Edit', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();
  const file = path.join(scratch, 'doc.md');
  fs.writeFileSync(file, '# Doc\n');

  const res = track(file, sessionId, scratch, pluginData, 'Edit');

  assert.equal(res.status, 0);
  assert.deepEqual(readTouched(pluginData, sessionId), [file]);
});

test('ignores non-.md files', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();
  const file = path.join(scratch, 'doc.txt');
  fs.writeFileSync(file, 'hello\n');

  track(file, sessionId, scratch, pluginData);

  assert.deepEqual(readTouched(pluginData, sessionId), []);
});

test('ignores tool names other than Edit/Write', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();
  const file = path.join(scratch, 'doc.md');
  fs.writeFileSync(file, '# Doc\n');

  track(file, sessionId, scratch, pluginData, 'Read');

  assert.deepEqual(readTouched(pluginData, sessionId), []);
});

test("ignores a file_path that doesn't exist on disk", (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();
  const file = path.join(scratch, 'missing.md');

  track(file, sessionId, scratch, pluginData);

  assert.deepEqual(readTouched(pluginData, sessionId), []);
});

test('dedups repeated writes to the same file', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();
  const file = path.join(scratch, 'doc.md');
  fs.writeFileSync(file, '# Doc\n');

  track(file, sessionId, scratch, pluginData);
  track(file, sessionId, scratch, pluginData);

  assert.deepEqual(readTouched(pluginData, sessionId), [file]);
});
