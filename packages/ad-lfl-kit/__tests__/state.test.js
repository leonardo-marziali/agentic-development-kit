'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  stateDir,
  readTrackedFiles,
  appendTrackedFile,
  readAttempts,
  writeAttempts,
  cleanup,
} = require('../state');
const { mkScratchDir, rmScratchDir, uniqueSessionId, writeFile } = require('./helpers');

test('stateDir uses CLAUDE_PLUGIN_DATA when set', () => {
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = '/tmp/plugin-data';
  try {
    assert.strictEqual(
      stateDir({ sessionId: 'abc', namespace: 'sonarqube-session-scope' }),
      path.join('/tmp/plugin-data', 'sonarqube-session-scope', 'abc'),
    );
  } finally {
    if (previous === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = previous;
  }
});

test('stateDir falls back to tmpdir and to a placeholder session', () => {
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  try {
    assert.strictEqual(
      stateDir({ namespace: 'ns' }),
      path.join(os.tmpdir(), 'ns', 'unknown-session'),
    );
  } finally {
    if (previous !== undefined) process.env.CLAUDE_PLUGIN_DATA = previous;
  }
});

test('stateDir keeps namespaces apart for the same session', () => {
  const a = stateDir({ sessionId: 's', namespace: 'markdown-session-scope' });
  const b = stateDir({ sessionId: 's', namespace: 'sonarqube-session-scope' });
  assert.notStrictEqual(a, b);
});

test('appendTrackedFile de-duplicates', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    const target = writeFile(dir, 'a.md');
    appendTrackedFile(listFile, target);
    appendTrackedFile(listFile, target);
    assert.strictEqual(fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean).length, 1);
  } finally {
    rmScratchDir(dir);
  }
});

test('readTrackedFiles drops entries whose file no longer exists', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    const kept = writeFile(dir, 'kept.md');
    const removed = writeFile(dir, 'removed.md');
    appendTrackedFile(listFile, kept);
    appendTrackedFile(listFile, removed);
    fs.rmSync(removed);
    assert.deepStrictEqual(readTrackedFiles(listFile), [kept]);
  } finally {
    rmScratchDir(dir);
  }
});

test('readTrackedFiles returns empty for a missing list', () => {
  assert.deepStrictEqual(
    readTrackedFiles(path.join(os.tmpdir(), uniqueSessionId(), 'nope.txt')),
    [],
  );
});

test('readAttempts defaults to 0 for missing and unparseable files', () => {
  const dir = mkScratchDir();
  try {
    assert.strictEqual(readAttempts(path.join(dir, 'missing.json')), 0);
    const broken = path.join(dir, 'broken.json');
    fs.writeFileSync(broken, 'not json');
    assert.strictEqual(readAttempts(broken), 0);
  } finally {
    rmScratchDir(dir);
  }
});

test('writeAttempts round-trips through readAttempts and creates the dir', () => {
  const dir = mkScratchDir();
  try {
    const attemptsFile = path.join(dir, 'nested', 'attempts.json');
    writeAttempts(attemptsFile, 2);
    assert.strictEqual(readAttempts(attemptsFile), 2);
  } finally {
    rmScratchDir(dir);
  }
});

test('cleanup removes owned files and the directory when it empties', () => {
  const dir = mkScratchDir();
  const stateSubdir = path.join(dir, 'state');
  fs.mkdirSync(stateSubdir);
  try {
    fs.writeFileSync(path.join(stateSubdir, 'touched.txt'), 'x');
    fs.writeFileSync(path.join(stateSubdir, 'attempts.json'), '{}');
    cleanup(stateSubdir, ['touched.txt', 'attempts.json']);
    assert.strictEqual(fs.existsSync(stateSubdir), false);
  } finally {
    rmScratchDir(dir);
  }
});

test('cleanup leaves another hook’s pending state intact', () => {
  const dir = mkScratchDir();
  const stateSubdir = path.join(dir, 'state');
  fs.mkdirSync(stateSubdir);
  try {
    fs.writeFileSync(path.join(stateSubdir, 'touched.txt'), 'x');
    const foreign = path.join(stateSubdir, 'other-hook.txt');
    fs.writeFileSync(foreign, 'still needed');

    cleanup(stateSubdir, ['touched.txt']);

    assert.strictEqual(fs.existsSync(stateSubdir), true, 'directory must survive');
    assert.strictEqual(fs.existsSync(foreign), true, 'foreign state must survive');
    assert.strictEqual(fs.existsSync(path.join(stateSubdir, 'touched.txt')), false);
  } finally {
    rmScratchDir(dir);
  }
});

test('cleanup tolerates a directory that is already gone', () => {
  const dir = mkScratchDir();
  rmScratchDir(dir);
  assert.doesNotThrow(() => cleanup(dir, ['touched.txt']));
});
