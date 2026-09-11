'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { resolveBin, quoteForCmd, runBin } = require('../exec');
const { mkScratchDir, rmScratchDir } = require('./helpers');

test('quoteForCmd wraps a plain argument without duplicating it', () => {
  /*
   * Regression guard for the forked implementation this package replaces,
   * which computed a zero-length trailing-backslash slice as slice(-0) — the
   * whole string — and emitted every plain argument twice.
   */
  assert.strictEqual(quoteForCmd('plain'), '"plain"');
  assert.strictEqual(quoteForCmd('C:\\Users\\x\\file.md'), '"C:\\Users\\x\\file.md"');
});

test('quoteForCmd doubles backslash runs before a quote and at the end', () => {
  assert.strictEqual(quoteForCmd('trail\\'), '"trail\\\\"');
  assert.strictEqual(quoteForCmd('say \\"hi\\"'), '"say \\\\""hi\\\\"""');
});

test('quoteForCmd coerces non-strings', () => {
  assert.strictEqual(quoteForCmd(42), '"42"');
});

test('resolveBin falls back to the bare name when nothing is found', () => {
  assert.strictEqual(
    resolveBin('definitely-not-a-real-binary-xyz'),
    'definitely-not-a-real-binary-xyz',
  );
});

test('resolveBin finds a binary in extraDirs', () => {
  const dir = mkScratchDir();
  try {
    const binName = 'fake-sonar';
    const full = path.join(dir, binName);
    fs.writeFileSync(full, '#!/bin/sh\nexit 0\n');
    assert.strictEqual(resolveBin(binName, { extraDirs: [dir] }), full);
  } finally {
    rmScratchDir(dir);
  }
});

test('resolveBin ignores empty entries in extraDirs', () => {
  assert.strictEqual(
    resolveBin('definitely-not-a-real-binary-xyz', { extraDirs: [null, ''] }),
    'definitely-not-a-real-binary-xyz',
  );
});

test('runBin executes a real binary and captures output', () => {
  const result = runBin('node', ['-e', 'process.stdout.write("hello")'], { encoding: 'utf8' });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, 'hello');
});

test('runBin surfaces a non-zero exit status', () => {
  const result = runBin('node', ['-e', 'process.exit(51)'], { encoding: 'utf8' });
  assert.strictEqual(result.status, 51);
});

test('runBin does not pass extraDirs through to spawn options', () => {
  /*
   * extraDirs is this package's own option; leaking it into spawnSync's
   * options would be harmless today but is exactly the kind of thing that
   * breaks when Node starts validating unknown keys.
   */
  const result = runBin('node', ['-e', 'process.stdout.write("ok")'], {
    encoding: 'utf8',
    extraDirs: ['/nonexistent'],
  });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.stdout, 'ok');
});
