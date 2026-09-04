'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveBin, quoteForCmd } = require('../lib');

test('resolveBin: returns a path that exists, or a bare name to resolve via PATH', () => {
  const bin = resolveBin('npx');
  assert.equal(typeof bin, 'string');
  assert.ok(bin.length > 0);
  if (path.isAbsolute(bin)) {
    assert.ok(fs.existsSync(bin), 'an absolute result must point at a real file');
  } else {
    // Bare fallback: platform-appropriate shim name for PATH lookup.
    assert.equal(bin, process.platform === 'win32' ? 'npx.cmd' : 'npx');
  }
});

test('resolveBin: never returns a bare POSIX name on win32', () => {
  // Guards the Windows breakage this replaced: Node cannot spawn an
  // extensionless `npx` shim there.
  if (process.platform !== 'win32') return;
  assert.notEqual(path.basename(resolveBin('npx')), 'npx');
});

test('quoteForCmd: wraps plain arguments', () => {
  assert.equal(quoteForCmd('C:\\tmp\\a.ts'), '"C:\\tmp\\a.ts"');
});

test('quoteForCmd: doubles trailing backslashes so they cannot escape the closing quote', () => {
  assert.equal(quoteForCmd('C:\\tmp\\dir\\'), '"C:\\tmp\\dir\\\\"');
});

test('quoteForCmd: escapes embedded quotes', () => {
  assert.equal(quoteForCmd('a"b'), '"a""b"');
});
