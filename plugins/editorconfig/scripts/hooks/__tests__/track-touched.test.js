'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newSession, touch } = require('./helpers');

function trackedFiles({ pluginData, sessionId }) {
  const list = path.join(pluginData, 'editorconfig-session-scope', sessionId, 'touched-files.txt');
  return fs.existsSync(list) ? fs.readFileSync(list, 'utf8').split('\n').filter(Boolean) : [];
}

test('tracks any file type on Write', (t) => {
  const session = newSession(t);
  const file = path.join(session.project, 'main.go');
  fs.writeFileSync(file, 'package main\n');

  assert.equal(touch(session, file).status, 0);
  assert.deepEqual(trackedFiles(session), [file]);
});

test('does not track files under node_modules', (t) => {
  const session = newSession(t);
  const file = path.join(session.project, 'node_modules', 'dep', 'index.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x\n');

  assert.equal(touch(session, file).status, 0);
  assert.deepEqual(trackedFiles(session), []);
});
