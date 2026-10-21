'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  changedRangesByFile,
  scopesFor,
  partitionByScope,
  fixableFiles,
  mergeRanges,
  widenRanges,
} = require('../scope');
const { mkScratchDir, rmScratchDir, writeFile, mkScratchRepo } = require('./helpers');

const EIGHT_LINES = 'a\nb\nc\nd\ne\nf\ng\nh\n';

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe', encoding: 'utf8' });
}

// No context margin, so a test asserts the raw hunk mapping rather than the widening.
function rangesOf(dir, name, options = { context: 0 }) {
  const file = path.join(dir, name);
  return scopesFor([file], options).get(file);
}

test('a modified line is in scope, the rest of the file is not', () => {
  const dir = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  try {
    writeFile(dir, 'doc.md', 'a\nB\nc\nd\ne\nf\ng\nh\n');

    const scope = rangesOf(dir, 'doc.md');

    assert.strictEqual(scope.all, false);
    assert.deepStrictEqual(scope.ranges, [[2, 2]]);
    assert.strictEqual(scope.includes(2), true);
    assert.strictEqual(scope.includes(7), false);
  } finally {
    rmScratchDir(dir);
  }
});

test('an inserted line is in scope', () => {
  const dir = mkScratchRepo({ 'doc.md': '1\n2\n3\n4\n' });
  try {
    writeFile(dir, 'doc.md', '1\n2\nNEW\n3\n4\n');

    assert.deepStrictEqual(rangesOf(dir, 'doc.md').ranges, [[3, 3]]);
  } finally {
    rmScratchDir(dir);
  }
});

test('a deleted line puts both sides of the splice in scope', () => {
  const dir = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  try {
    // Drop line 5 ("e"); git reports `@@ -5 +4,0 @@`.
    writeFile(dir, 'doc.md', 'a\nb\nc\nd\nf\ng\nh\n');

    assert.deepStrictEqual(rangesOf(dir, 'doc.md').ranges, [[4, 5]]);
  } finally {
    rmScratchDir(dir);
  }
});

test('deleting the first line clamps the range to line 1', () => {
  const dir = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  try {
    // git reports `@@ -1 +0,0 @@` — a naive mapping would produce line 0.
    writeFile(dir, 'doc.md', 'b\nc\nd\ne\nf\ng\nh\n');

    assert.deepStrictEqual(rangesOf(dir, 'doc.md').ranges, [[1, 2]]);
  } finally {
    rmScratchDir(dir);
  }
});

test('a staged change is in scope', () => {
  const dir = mkScratchRepo({ 'doc.md': '1\n2\n3\n4\n' });
  try {
    writeFile(dir, 'doc.md', '1\n2\nNEW\n3\n4\n');
    git(dir, 'add', 'doc.md');

    // `git diff` alone would see nothing here; this is why the ref is HEAD.
    assert.deepStrictEqual(rangesOf(dir, 'doc.md').ranges, [[3, 3]]);
  } finally {
    rmScratchDir(dir);
  }
});

test('two distant edits produce two disjoint ranges', () => {
  const dir = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  try {
    writeFile(dir, 'doc.md', 'a\nB\nc\nd\ne\nf\nG\nh\n');

    assert.deepStrictEqual(rangesOf(dir, 'doc.md').ranges, [
      [2, 2],
      [7, 7],
    ]);
  } finally {
    rmScratchDir(dir);
  }
});

test('a path containing a space is still scoped', () => {
  // git appends a TAB to the `+++` line for such paths; without stripping it
  // the file resolves to a path that exists nowhere and drops out of scope.
  const dir = mkScratchRepo({ 'two words.md': EIGHT_LINES });
  try {
    writeFile(dir, 'two words.md', 'a\nB\nc\nd\ne\nf\ng\nh\n');

    const scope = rangesOf(dir, 'two words.md');

    assert.strictEqual(scope.all, false);
    assert.deepStrictEqual(scope.ranges, [[2, 2]]);
  } finally {
    rmScratchDir(dir);
  }
});

test('a tracked file reverted to its HEAD content has nothing in scope', () => {
  const dir = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  try {
    writeFile(dir, 'doc.md', 'a\nB\nc\nd\ne\nf\ng\nh\n');
    writeFile(dir, 'doc.md', EIGHT_LINES);

    const scope = rangesOf(dir, 'doc.md');

    assert.strictEqual(scope.all, false);
    assert.deepStrictEqual(scope.ranges, []);
    assert.strictEqual(scope.includes(2), false);
  } finally {
    rmScratchDir(dir);
  }
});

test('an untracked file is wholly in scope', () => {
  const dir = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  try {
    writeFile(dir, 'fresh.md', EIGHT_LINES);

    const scope = rangesOf(dir, 'fresh.md');

    assert.strictEqual(scope.all, true);
    assert.strictEqual(scope.includes(999), true);
  } finally {
    rmScratchDir(dir);
  }
});

test('a gitignored file is wholly in scope', () => {
  const dir = mkScratchRepo({ 'doc.md': EIGHT_LINES, '.gitignore': 'generated.md\n' });
  try {
    writeFile(dir, 'generated.md', EIGHT_LINES);

    assert.strictEqual(rangesOf(dir, 'generated.md').all, true);
  } finally {
    rmScratchDir(dir);
  }
});

test('a file outside any repository is wholly in scope', () => {
  const dir = fs.realpathSync(mkScratchDir());
  try {
    writeFile(dir, 'doc.md', EIGHT_LINES);

    assert.strictEqual(rangesOf(dir, 'doc.md').all, true);
  } finally {
    rmScratchDir(dir);
  }
});

test('files in two different repositories are grouped and scoped separately', () => {
  const one = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  const two = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  try {
    writeFile(one, 'doc.md', 'a\nB\nc\nd\ne\nf\ng\nh\n');
    writeFile(two, 'doc.md', 'a\nb\nc\nd\ne\nf\nG\nh\n');

    const files = [path.join(one, 'doc.md'), path.join(two, 'doc.md')];
    const changed = changedRangesByFile(files);

    assert.deepStrictEqual(changed.get(files[0]).ranges, [[2, 2]]);
    assert.deepStrictEqual(changed.get(files[1]).ranges, [[7, 7]]);
  } finally {
    rmScratchDir(one);
    rmScratchDir(two);
  }
});

test('an unknown ref scopes whole files rather than reporting no changes', () => {
  const dir = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  try {
    writeFile(dir, 'doc.md', 'a\nB\nc\nd\ne\nf\ng\nh\n');

    assert.strictEqual(rangesOf(dir, 'doc.md', { ref: 'no-such-ref', context: 0 }).all, true);
  } finally {
    rmScratchDir(dir);
  }
});

test('the context margin widens ranges and clamps at the first line', () => {
  const dir = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  try {
    writeFile(dir, 'doc.md', 'A\nb\nc\nd\ne\nf\ng\nh\n');

    const scope = rangesOf(dir, 'doc.md', { context: 2 });

    assert.deepStrictEqual(scope.ranges, [[1, 3]]);
    assert.strictEqual(scope.includes(3), true);
    assert.strictEqual(scope.includes(4), false);
  } finally {
    rmScratchDir(dir);
  }
});

test('scopesFor applies a context margin of 2 by default', () => {
  const dir = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  try {
    writeFile(dir, 'doc.md', 'a\nb\nc\nD\ne\nf\ng\nh\n');

    assert.deepStrictEqual(rangesOf(dir, 'doc.md', {}).ranges, [[2, 6]]);
  } finally {
    rmScratchDir(dir);
  }
});

test('widening merges ranges that overlap or touch', () => {
  assert.deepStrictEqual(
    widenRanges(
      [
        [10, 10],
        [13, 13],
      ],
      2,
    ),
    [[8, 15]],
  );
  assert.deepStrictEqual(
    widenRanges(
      [
        [10, 10],
        [40, 40],
      ],
      2,
    ),
    [
      [8, 12],
      [38, 42],
    ],
  );
});

test('mergeRanges collapses touching ranges and sorts out of order input', () => {
  assert.deepStrictEqual(
    mergeRanges([
      [5, 6],
      [1, 2],
      [3, 4],
    ]),
    [[1, 6]],
  );
});

test('a violation with no line number is in scope only when the whole file is', () => {
  const dir = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  try {
    writeFile(dir, 'doc.md', 'a\nB\nc\nd\ne\nf\ng\nh\n');
    writeFile(dir, 'fresh.md', EIGHT_LINES);

    assert.strictEqual(rangesOf(dir, 'doc.md').includes(undefined), false);
    assert.strictEqual(rangesOf(dir, 'fresh.md').includes(undefined), true);
  } finally {
    rmScratchDir(dir);
  }
});

test('partitionByScope splits a mixed finding list and names the affected files', () => {
  const dir = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  try {
    writeFile(dir, 'doc.md', 'a\nB\nc\nd\ne\nf\ng\nh\n');
    const file = path.join(dir, 'doc.md');
    const scopes = scopesFor([file], { context: 0 });

    const { inScope, outOfScope, outOfScopeFiles } = partitionByScope(
      [
        { fileName: file, lineNumber: 2, rule: 'touched' },
        { fileName: file, lineNumber: 7, rule: 'pre-existing' },
      ],
      { scopes },
    );

    assert.deepStrictEqual(
      inScope.map((v) => v.rule),
      ['touched'],
    );
    assert.deepStrictEqual(
      outOfScope.map((v) => v.rule),
      ['pre-existing'],
    );
    assert.deepStrictEqual([...outOfScopeFiles], [file]);
  } finally {
    rmScratchDir(dir);
  }
});

test('a finding for a file that was never scoped counts as in scope', () => {
  const { inScope, outOfScope } = partitionByScope([{ file: '/nowhere/doc.md', line: 3 }], {
    scopes: new Map(),
  });

  assert.strictEqual(inScope.length, 1);
  assert.strictEqual(outOfScope.length, 0);
});

test('fixableFiles excludes any file with an out-of-scope finding', () => {
  const clean = '/repo/clean.md';
  const dirty = '/repo/dirty.md';

  assert.deepStrictEqual(
    fixableFiles({ files: [clean, dirty], outOfScopeFiles: new Set([dirty]) }),
    [clean],
  );
  assert.deepStrictEqual(fixableFiles({ files: [clean, dirty] }), [clean, dirty]);
});

test('no files means no work and no git invocations', () => {
  assert.strictEqual(changedRangesByFile([]).size, 0);
  assert.strictEqual(scopesFor().size, 0);
});
