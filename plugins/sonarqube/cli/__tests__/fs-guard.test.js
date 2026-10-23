'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveInside } = require('../fs-guard');

function project(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-guard-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'root');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'x');
  fs.writeFileSync(path.join(base, 'secret.txt'), 'outside');
  return { base, root };
}

test('a file inside the root resolves to its real path', (t) => {
  const { root } = project(t);
  const r = resolveInside(root, 'src/a.js');
  assert.equal(r.ok, true);
  assert.equal(r.abs, fs.realpathSync(path.join(root, 'src', 'a.js')));
  assert.equal(resolveInside(root, path.join(root, 'src', 'a.js')).ok, true);
});

test('.. traversal is refused', (t) => {
  const { root } = project(t);
  assert.deepEqual(
    [
      resolveInside(root, '../secret.txt').reason,
      resolveInside(root, 'src/../../secret.txt').reason,
    ],
    ['outside the project root', 'outside the project root'],
  );
});

test(
  'a symlink pointing out of the root is refused',
  { skip: process.platform === 'win32' },
  (t) => {
    const { base, root } = project(t);
    fs.symlinkSync(path.join(base, 'secret.txt'), path.join(root, 'src', 'link.txt'));
    const r = resolveInside(root, 'src/link.txt');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'resolves outside the project root');
  },
);

test('missing files and directories are refused with a reason', (t) => {
  const { root } = project(t);
  assert.equal(resolveInside(root, 'src/nope.js').reason, 'not found');
  assert.equal(resolveInside(root, 'src').reason, 'not a regular file');
});

test(
  'virtual files may not exist yet but must still be inside',
  { skip: process.platform === 'win32' },
  (t) => {
    const { base, root } = project(t);
    assert.equal(resolveInside(root, 'src/new/deep/file.ts', { mustExist: false }).ok, true);
    assert.equal(resolveInside(root, '../evil.py', { mustExist: false }).ok, false);
    fs.symlinkSync(base, path.join(root, 'escape'));
    assert.equal(resolveInside(root, 'escape/new.py', { mustExist: false }).ok, false);
  },
);
