'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { trackTouchedFile } = require('../track');
const { mkScratchDir, rmScratchDir, writeFile } = require('./helpers');

function payload(dir, filePath, overrides = {}) {
  return {
    tool_name: 'Edit',
    tool_input: { file_path: filePath },
    cwd: dir,
    session_id: 'test-session',
    ...overrides,
  };
}

test('tracks an edited file that matches', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'state', 'touched.txt');
    const target = writeFile(dir, 'doc.md');

    const tracked = trackTouchedFile({
      input: payload(dir, target),
      listFile,
      matches: (p) => p.endsWith('.md'),
    });

    assert.strictEqual(tracked, target);
    assert.strictEqual(fs.readFileSync(listFile, 'utf8').trim(), target);
  } finally {
    rmScratchDir(dir);
  }
});

test('resolves a relative tool path against the session cwd', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    const target = writeFile(dir, 'nested/doc.md');

    const tracked = trackTouchedFile({
      input: payload(dir, 'nested/doc.md'),
      listFile,
      matches: () => true,
    });

    assert.strictEqual(tracked, target);
  } finally {
    rmScratchDir(dir);
  }
});

test('ignores tools other than Edit and Write', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    const target = writeFile(dir, 'doc.md');

    const tracked = trackTouchedFile({
      input: payload(dir, target, { tool_name: 'Read' }),
      listFile,
      matches: () => true,
    });

    assert.strictEqual(tracked, null);
    assert.strictEqual(fs.existsSync(listFile), false);
  } finally {
    rmScratchDir(dir);
  }
});

test('accepts Write as well as Edit', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    const target = writeFile(dir, 'doc.md');
    const tracked = trackTouchedFile({
      input: payload(dir, target, { tool_name: 'Write' }),
      listFile,
      matches: () => true,
    });
    assert.strictEqual(tracked, target);
  } finally {
    rmScratchDir(dir);
  }
});

test('ignores a file the matcher rejects', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    const target = writeFile(dir, 'notes.txt');
    const tracked = trackTouchedFile({
      input: payload(dir, target),
      listFile,
      matches: (p) => p.endsWith('.md'),
    });
    assert.strictEqual(tracked, null);
    assert.strictEqual(fs.existsSync(listFile), false);
  } finally {
    rmScratchDir(dir);
  }
});

test('ignores a file that no longer exists', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    const tracked = trackTouchedFile({
      input: payload(dir, path.join(dir, 'gone.md')),
      listFile,
      matches: () => true,
    });
    assert.strictEqual(tracked, null);
  } finally {
    rmScratchDir(dir);
  }
});

test('returns null for null input or a missing file_path', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    assert.strictEqual(trackTouchedFile({ input: null, listFile, matches: () => true }), null);
    assert.strictEqual(
      trackTouchedFile({
        input: { tool_name: 'Edit', tool_input: {} },
        listFile,
        matches: () => true,
      }),
      null,
    );
  } finally {
    rmScratchDir(dir);
  }
});

test('tracks everything when no matcher is supplied', () => {
  const dir = mkScratchDir();
  try {
    const listFile = path.join(dir, 'touched.txt');
    const target = writeFile(dir, 'anything.bin');
    assert.strictEqual(trackTouchedFile({ input: payload(dir, target), listFile }), target);
  } finally {
    rmScratchDir(dir);
  }
});
