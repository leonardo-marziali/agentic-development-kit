'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { resolveConfigDir, groupByConfigDir } = require('../lib');
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
