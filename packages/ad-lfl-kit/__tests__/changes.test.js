'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { snapshotWorkspace, filesChangedSince, MTIME_SLACK_MS } = require('../changes');
const { mkScratchDir, mkScratchRepo, rmScratchDir, writeFile } = require('./helpers');

/*
 * Ages a file's mtime to well before any snapshot taken now, standing in for
 * a file last written before the tool call started.
 */
function age(file, ms = 60_000) {
  const then = new Date(Date.now() - ms);
  fs.utimesSync(file, then, then);
}

function gitCommit(dir, message, { date } = {}) {
  const env = date
    ? { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date }
    : process.env;
  const run = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe', env });
  run('add', '--all');
  run(
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

test('records the repo root and HEAD of the cwd', () => {
  const repo = mkScratchRepo({ 'a.py': 'x = 1\n' });
  try {
    const snap = snapshotWorkspace(path.join(repo));
    assert.strictEqual(snap.root, repo);
    assert.match(snap.head, /^[0-9a-f]{40}$/);
    assert.strictEqual(typeof snap.startedAt, 'number');
  } finally {
    rmScratchDir(repo);
  }
});

test('finds tracked edits and new untracked files written after the snapshot', () => {
  const repo = mkScratchRepo({ 'a.py': 'x = 1\n', 'b.py': 'y = 1\n' });
  try {
    age(path.join(repo, 'a.py'));
    age(path.join(repo, 'b.py'));
    const snap = snapshotWorkspace(repo);

    fs.writeFileSync(path.join(repo, 'a.py'), 'x = 2\n');
    writeFile(repo, 'pkg/new.py', 'z = 1\n');

    assert.deepStrictEqual(filesChangedSince(snap).sort(), [
      path.join(repo, 'a.py'),
      path.join(repo, 'pkg/new.py'),
    ]);
  } finally {
    rmScratchDir(repo);
  }
});

test('leaves out files that were already dirty before the snapshot', () => {
  const repo = mkScratchRepo({ 'a.py': 'x = 1\n' });
  try {
    fs.writeFileSync(path.join(repo, 'a.py'), 'x = 2\n');
    writeFile(repo, 'old-untracked.py', 'y = 1\n');
    age(path.join(repo, 'a.py'), MTIME_SLACK_MS + 60_000);
    age(path.join(repo, 'old-untracked.py'), MTIME_SLACK_MS + 60_000);

    assert.deepStrictEqual(filesChangedSince(snapshotWorkspace(repo)), []);
  } finally {
    rmScratchDir(repo);
  }
});

test('finds files the call edited and then committed itself', () => {
  const repo = mkScratchRepo({ 'a.py': 'x = 1\n' });
  try {
    age(path.join(repo, 'a.py'));
    const snap = snapshotWorkspace(repo);

    fs.writeFileSync(path.join(repo, 'a.py'), 'x = 2\n');
    gitCommit(repo, 'edit');

    assert.deepStrictEqual(filesChangedSince(snap), [path.join(repo, 'a.py')]);
  } finally {
    rmScratchDir(repo);
  }
});

test('leaves out files brought in by older commits, as a pull or checkout would', () => {
  const repo = mkScratchRepo({ 'a.py': 'x = 1\n' });
  try {
    const snap = snapshotWorkspace(repo);

    // A commit dated long before the call, standing in for one pulled in.
    writeFile(repo, 'theirs.py', 'y = 1\n');
    gitCommit(repo, 'theirs', { date: '2020-01-01T00:00:00Z' });

    assert.deepStrictEqual(filesChangedSince(snap), []);
  } finally {
    rmScratchDir(repo);
  }
});

test('skips gitignored files and dependency directories', () => {
  const repo = mkScratchRepo({ '.gitignore': 'build/\n' });
  try {
    const snap = snapshotWorkspace(repo);
    writeFile(repo, 'build/out.py', 'x = 1\n');
    // Not gitignored, as in a project too young to have it in .gitignore yet.
    writeFile(repo, '.venv/lib/site.py', 'x = 1\n');
    writeFile(repo, 'node_modules/pkg/README.md', '# x\n');
    const kept = writeFile(repo, 'src/app.py', 'x = 1\n');

    assert.deepStrictEqual(filesChangedSince(snap), [kept]);
  } finally {
    rmScratchDir(repo);
  }
});

test('ignores deleted files', () => {
  const repo = mkScratchRepo({ 'a.py': 'x = 1\n' });
  try {
    const snap = snapshotWorkspace(repo);
    fs.rmSync(path.join(repo, 'a.py'));
    assert.deepStrictEqual(filesChangedSince(snap), []);
  } finally {
    rmScratchDir(repo);
  }
});

test('reports the new path of a renamed file', () => {
  const repo = mkScratchRepo({ 'a.py': 'x = 1\n' });
  try {
    const snap = snapshotWorkspace(repo);
    execFileSync('git', ['-C', repo, 'mv', 'a.py', 'b.py']);
    fs.writeFileSync(path.join(repo, 'b.py'), 'x = 2\n');
    assert.deepStrictEqual(filesChangedSince(snap), [path.join(repo, 'b.py')]);
  } finally {
    rmScratchDir(repo);
  }
});

test('also scans the repo the command cd-ed into', () => {
  const outer = mkScratchRepo({ 'a.py': 'x = 1\n' });
  const other = mkScratchRepo({ 'b.py': 'y = 1\n' });
  try {
    const snap = snapshotWorkspace(outer);
    const written = writeFile(other, 'c.py', 'z = 1\n');
    assert.deepStrictEqual(filesChangedSince(snap, { cwd: other }), [written]);
  } finally {
    rmScratchDir(outer);
    rmScratchDir(other);
  }
});

test('walks the cwd when it is not a git repo', () => {
  const dir = fs.realpathSync(mkScratchDir());
  try {
    const old = writeFile(dir, 'old.py', 'x = 1\n');
    age(old);
    const snap = snapshotWorkspace(dir);
    assert.strictEqual(snap.root, null);

    const fresh = writeFile(dir, 'nested/new.py', 'y = 1\n');
    writeFile(dir, 'node_modules/x.js', '');
    assert.deepStrictEqual(filesChangedSince(snap), [fresh]);
  } finally {
    rmScratchDir(dir);
  }
});

test('returns nothing for a missing or malformed snapshot', () => {
  assert.deepStrictEqual(filesChangedSince(null), []);
  assert.deepStrictEqual(filesChangedSince({}), []);
});
