'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchDir, rmScratchDir, uniqueSessionId, runHook } = require('./helpers');

function readTouched(pluginData, sessionId) {
  const listFile = path.join(
    pluginData,
    'editorconfig-session-scope',
    sessionId,
    'touched-files.txt',
  );
  if (!fs.existsSync(listFile)) return [];
  return fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean);
}

function track(file, sessionId, scratch, pluginData) {
  return runHook(
    'track-touched.js',
    {
      tool_name: 'Write',
      tool_input: { file_path: file },
      session_id: sessionId,
      cwd: scratch,
    },
    { env: { CLAUDE_PLUGIN_DATA: pluginData } },
  );
}

test('tracks any file type on Write', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();
  const file = path.join(scratch, 'main.go');
  fs.writeFileSync(file, 'package main\n');

  const res = track(file, sessionId, scratch, pluginData);

  assert.equal(res.status, 0);
  assert.deepEqual(readTouched(pluginData, sessionId), [file]);
});

test('does not track files under node_modules', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();
  const file = path.join(scratch, 'node_modules', 'dep', 'index.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x\n');

  const res = track(file, sessionId, scratch, pluginData);

  assert.equal(res.status, 0);
  assert.deepEqual(readTouched(pluginData, sessionId), []);
});
