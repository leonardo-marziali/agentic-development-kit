'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  resolveConfigDir,
  groupByConfigDir,
  parseViolationsJson,
  resolveBin,
  quoteForCmd,
} = require('../lib');
const { mkScratchDir, rmScratchDir } = require('./helpers');

test("resolveConfigDir: finds a config in the file's own directory", (t) => {
  const dir = mkScratchDir();
  t.after(() => rmScratchDir(dir));
  fs.writeFileSync(path.join(dir, '.markdownlint.json'), '{}');
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, '# Doc\n');

  assert.equal(resolveConfigDir(file), dir);
});

test('resolveConfigDir: walks up to an ancestor when none is present locally', (t) => {
  const root = mkScratchDir();
  t.after(() => rmScratchDir(root));
  fs.writeFileSync(path.join(root, '.markdownlint.yaml'), 'MD025: false\n');
  const nested = path.join(root, 'a', 'b', 'c');
  fs.mkdirSync(nested, { recursive: true });
  const file = path.join(nested, 'doc.md');
  fs.writeFileSync(file, '# Doc\n');

  assert.equal(resolveConfigDir(file), root);
});

test('resolveConfigDir: stops at the nearest config rather than a farther ancestor', (t) => {
  const root = mkScratchDir();
  t.after(() => rmScratchDir(root));
  fs.writeFileSync(path.join(root, '.markdownlint.json'), '{}'); // farther
  const near = path.join(root, 'a', 'b');
  fs.mkdirSync(near, { recursive: true });
  fs.writeFileSync(path.join(near, '.markdownlint.yaml'), 'MD025: false\n'); // nearer
  const file = path.join(near, 'c', 'doc.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '# Doc\n');

  assert.equal(resolveConfigDir(file), near);
});

test("resolveConfigDir: falls back to the file's own directory when no config exists anywhere above it", (t) => {
  const dir = mkScratchDir();
  t.after(() => rmScratchDir(dir));
  const file = path.join(dir, 'doc.md');
  fs.writeFileSync(file, '# Doc\n');

  assert.equal(resolveConfigDir(file), dir);
});

test('groupByConfigDir: groups files that share a resolved config directory together', (t) => {
  const dir = mkScratchDir();
  t.after(() => rmScratchDir(dir));
  fs.writeFileSync(path.join(dir, '.markdownlint.json'), '{}');
  const fileA = path.join(dir, 'a.md');
  const fileB = path.join(dir, 'b.md');
  fs.writeFileSync(fileA, '# A\n');
  fs.writeFileSync(fileB, '# B\n');

  const groups = groupByConfigDir([fileA, fileB]);

  assert.equal(groups.size, 1);
  assert.deepEqual(groups.get(dir), [fileA, fileB]);
});

test('parseViolationsJson: parses a clean JSON array', () => {
  const parsed = parseViolationsJson('[{"fileName":"a.md","lineNumber":3,"ruleNames":["MD025"]}]');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].ruleNames[0], 'MD025');
});

test('parseViolationsJson: recovers the payload when npx prepends a notice', () => {
  const noisy =
    'Need to install the following packages:\nmarkdownlint-cli@0.45.0\nOk to proceed? (y)\n' +
    '[{"fileName":"a.md","lineNumber":3,"ruleNames":["MD025"]}]';
  const parsed = parseViolationsJson(noisy);
  assert.ok(parsed, 'noise before the array must not defeat parsing');
  assert.equal(parsed[0].fileName, 'a.md');
});

test('parseViolationsJson: recovers the payload when noise follows it', () => {
  const noisy = '[{"fileName":"a.md","lineNumber":3,"ruleNames":["MD025"]}]\nnpm notice trailing\n';
  const parsed = parseViolationsJson(noisy);
  assert.ok(parsed);
  assert.equal(parsed.length, 1);
});

test('parseViolationsJson: empty output yields null', () => {
  assert.equal(parseViolationsJson(''), null);
  assert.equal(parseViolationsJson('   \n'), null);
  assert.equal(parseViolationsJson(undefined), null);
});

test('parseViolationsJson: output with no array at all yields null', () => {
  assert.equal(parseViolationsJson('npm ERR! could not determine executable to run'), null);
});

test('parseViolationsJson: a non-array JSON value yields null', () => {
  assert.equal(parseViolationsJson('{"not":"an array"}'), null);
});

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
  assert.equal(quoteForCmd('C:\\tmp\\a.md'), '"C:\\tmp\\a.md"');
});

test('quoteForCmd: doubles trailing backslashes so they cannot escape the closing quote', () => {
  assert.equal(quoteForCmd('C:\\tmp\\dir\\'), '"C:\\tmp\\dir\\\\"');
});

test('quoteForCmd: escapes embedded quotes', () => {
  assert.equal(quoteForCmd('a"b'), '"a""b"');
});
