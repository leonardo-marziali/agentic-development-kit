'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { SESSION_BASE_FILE, readSessionBases, recordSessionBase, knownRootFor } = require('../base');
const { trackTouchedFile, trackSessionChanges } = require('../track');
const { scopesFor } = require('../scope');
const { mkScratchDir, mkScratchRepo, rmScratchDir, writeFile } = require('./helpers');

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe', encoding: 'utf8' }).trim();
}

function commitAll(dir, message = 'session commit') {
  git(dir, 'add', '--all');
  git(
    dir,
    '-c',
    'user.email=test@example.com',
    '-c',
    'user.name=Test',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '--no-verify',
    '-m',
    message,
  );
}

function aged(file) {
  const then = new Date(Date.now() - 60_000);
  fs.utimesSync(file, then, then);
  return file;
}

const EIGHT_LINES = 'a\nb\nc\nd\ne\nf\ng\nh\n';
const LINE_TWO_EDITED = 'a\nB\nc\nd\ne\nf\ng\nh\n';

test('readSessionBases is empty when nothing was recorded or the file is garbage', () => {
  const dir = mkScratchDir();
  try {
    assert.deepStrictEqual(readSessionBases(dir), {});
    fs.writeFileSync(path.join(dir, SESSION_BASE_FILE), '{not json');
    assert.deepStrictEqual(readSessionBases(dir), {});
    fs.writeFileSync(path.join(dir, SESSION_BASE_FILE), JSON.stringify({ '/r': 'not a sha' }));
    assert.deepStrictEqual(readSessionBases(dir), {});
  } finally {
    rmScratchDir(dir);
  }
});

test('recordSessionBase keeps the first base recorded for a repo', () => {
  const dir = mkScratchDir();
  try {
    assert.strictEqual(recordSessionBase(dir, '/repo', 'a'.repeat(40)), true);
    assert.strictEqual(recordSessionBase(dir, '/repo', 'b'.repeat(40)), false);
    assert.strictEqual(recordSessionBase(dir, '/other', 'c'.repeat(40)), true);
    assert.strictEqual(recordSessionBase(dir, '/third', null), false);
    assert.deepStrictEqual(readSessionBases(dir), {
      '/repo': 'a'.repeat(40),
      '/other': 'c'.repeat(40),
    });
  } finally {
    rmScratchDir(dir);
  }
});

test('knownRootFor picks the deepest recorded root containing the path', () => {
  const bases = { '/r': 'x', '/r/sub': 'y' };
  assert.strictEqual(knownRootFor(bases, '/r/a.md'), '/r');
  assert.strictEqual(knownRootFor(bases, '/r/sub/a.md'), '/r/sub');
  assert.strictEqual(knownRootFor(bases, '/rx/a.md'), null);
  assert.strictEqual(knownRootFor(bases, '/r'), null);
});

test('an Edit records the repo HEAD as the session base', () => {
  const repo = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  const state = mkScratchDir();
  try {
    const head = git(repo, 'rev-parse', 'HEAD');
    const target = writeFile(repo, 'doc.md', LINE_TWO_EDITED);
    trackTouchedFile({
      input: { tool_name: 'Edit', tool_input: { file_path: target }, cwd: repo },
      listFile: path.join(state, 'touched.txt'),
    });

    assert.deepStrictEqual(readSessionBases(state), { [repo]: head });
  } finally {
    rmScratchDir(repo);
    rmScratchDir(state);
  }
});

test('a later commit does not move the base already recorded', () => {
  const repo = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  const state = mkScratchDir();
  try {
    const head = git(repo, 'rev-parse', 'HEAD');
    const listFile = path.join(state, 'touched.txt');
    const target = writeFile(repo, 'doc.md', LINE_TWO_EDITED);
    const edit = { tool_name: 'Edit', tool_input: { file_path: target }, cwd: repo };

    trackSessionChanges({ input: edit, listFile });
    commitAll(repo);
    writeFile(repo, 'doc.md', 'a\nB\nC\nd\ne\nf\ng\nh\n');
    trackSessionChanges({ input: edit, listFile });

    assert.deepStrictEqual(readSessionBases(state), { [repo]: head });
  } finally {
    rmScratchDir(repo);
    rmScratchDir(state);
  }
});

test('`edit && git commit` in one Bash call records the HEAD from before the call', () => {
  const repo = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  const state = mkScratchDir();
  try {
    aged(path.join(repo, 'doc.md'));
    const before = git(repo, 'rev-parse', 'HEAD');
    const listFile = path.join(state, 'touched.txt');
    const bash = (event) => ({
      hook_event_name: event,
      tool_name: 'Bash',
      tool_input: { command: 'sed -i s/b/B/ doc.md && git commit -am x' },
      tool_use_id: 'toolu_base',
      cwd: repo,
    });

    trackSessionChanges({ input: bash('PreToolUse'), listFile });
    writeFile(repo, 'doc.md', LINE_TWO_EDITED);
    commitAll(repo);
    const tracked = trackSessionChanges({ input: bash('PostToolUse'), listFile });

    assert.deepStrictEqual(tracked, [path.join(repo, 'doc.md')]);
    assert.notStrictEqual(git(repo, 'rev-parse', 'HEAD'), before);
    assert.deepStrictEqual(readSessionBases(state), { [repo]: before });
  } finally {
    rmScratchDir(repo);
    rmScratchDir(state);
  }
});

test('a file the session committed drops out of a HEAD scope but not a session-base one', () => {
  const repo = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  const state = mkScratchDir();
  try {
    const target = writeFile(repo, 'doc.md', LINE_TWO_EDITED);
    trackTouchedFile({
      input: { tool_name: 'Write', tool_input: { file_path: target }, cwd: repo },
      listFile: path.join(state, 'touched.txt'),
    });
    commitAll(repo);

    const againstHead = scopesFor([target], { context: 0 }).get(target);
    assert.deepStrictEqual(againstHead.ranges, [], 'the bug: HEAD already holds the edit');
    assert.strictEqual(againstHead.includes(2), false);

    const againstBase = scopesFor([target], { context: 0, bases: readSessionBases(state) }).get(
      target,
    );
    assert.strictEqual(againstBase.all, false);
    assert.deepStrictEqual(againstBase.ranges, [[2, 2]]);
    assert.strictEqual(againstBase.includes(2), true);
  } finally {
    rmScratchDir(repo);
    rmScratchDir(state);
  }
});

test('a base diff covers committed and uncommitted session lines together', () => {
  const repo = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  try {
    const base = git(repo, 'rev-parse', 'HEAD');
    const target = writeFile(repo, 'doc.md', LINE_TWO_EDITED);
    commitAll(repo);
    writeFile(repo, 'doc.md', 'a\nB\nc\nd\ne\nf\nG\nh\n');

    const scope = scopesFor([target], { context: 0, bases: new Map([[repo, base]]) }).get(target);
    assert.deepStrictEqual(scope.ranges, [
      [2, 2],
      [7, 7],
    ]);
  } finally {
    rmScratchDir(repo);
  }
});

test('a base that no longer resolves falls back to the ref', () => {
  const repo = mkScratchRepo({ 'doc.md': EIGHT_LINES });
  try {
    const target = writeFile(repo, 'doc.md', LINE_TWO_EDITED);
    const scope = scopesFor([target], {
      context: 0,
      bases: { [repo]: 'f'.repeat(40) },
    }).get(target);
    assert.deepStrictEqual(scope.ranges, [[2, 2]]);
  } finally {
    rmScratchDir(repo);
  }
});
