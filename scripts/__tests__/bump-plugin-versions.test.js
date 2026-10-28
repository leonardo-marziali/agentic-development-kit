'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { mkScratchDir, rmScratchDir } = require('./helpers');
const { bumpVersion, resolveGit, run, parseArgs } = require('../bump-plugin-versions');

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function manifest(name, version) {
  return `{\n  "name": "${name}",\n  "version": "${version}",\n  "keywords": ["a", "b"]\n}\n`;
}

// Two plugins tagged v1.0.0; callers then modify files and commit.
function makeRepo() {
  const root = mkScratchDir('adk-bump-plugin-versions-test-');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 't');
  git(root, 'config', 'commit.gpgsign', 'false');
  for (const [name, version] of [
    ['alpha', '0.1.0'],
    ['beta', '0.2.5'],
  ]) {
    const dir = path.join(root, 'plugins', name);
    fs.mkdirSync(path.join(dir, '.claude-plugin'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), manifest(name, version));
    fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}\n`);
  }
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'chore: init');
  git(root, 'tag', 'v1.0.0');
  return root;
}

function commitChange(root, file) {
  fs.writeFileSync(path.join(root, file), 'changed\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'feat: change');
}

function versionOf(root, name) {
  const file = path.join(root, 'plugins', name, '.claude-plugin', 'plugin.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')).version;
}

test('bumpVersion applies major, minor and patch', () => {
  assert.equal(bumpVersion('1.2.3', 'major'), '2.0.0');
  assert.equal(bumpVersion('1.2.3', 'minor'), '1.3.0');
  assert.equal(bumpVersion('1.2.3', 'patch'), '1.2.4');
});

test('bumpVersion rejects bad input', () => {
  assert.throws(() => bumpVersion('1.2', 'patch'), /MAJOR\.MINOR\.PATCH/);
  assert.throws(() => bumpVersion('1.2.3', 'huge'), /Unknown release type/);
});

test('run bumps only the plugins changed since the last tag', () => {
  const root = makeRepo();
  try {
    commitChange(root, 'plugins/alpha/README.md');
    const bumped = run({ type: 'minor', sinceRef: 'v1.0.0', repoRoot: root, log: () => {} });
    assert.deepEqual(bumped, ['alpha']);
    assert.equal(versionOf(root, 'alpha'), '0.2.0');
    assert.equal(versionOf(root, 'beta'), '0.2.5');
  } finally {
    rmScratchDir(root);
  }
});

test('run leaves the rest of the manifest byte-for-byte intact', () => {
  const root = makeRepo();
  try {
    commitChange(root, 'plugins/beta/README.md');
    run({ type: 'patch', sinceRef: 'v1.0.0', repoRoot: root, log: () => {} });
    const file = path.join(root, 'plugins', 'beta', '.claude-plugin', 'plugin.json');
    assert.equal(fs.readFileSync(file, 'utf8'), manifest('beta', '0.2.6'));
  } finally {
    rmScratchDir(root);
  }
});

test('run does nothing when only files outside plugins/ changed', () => {
  const root = makeRepo();
  try {
    commitChange(root, 'CHANGELOG.md');
    const bumped = run({ type: 'major', sinceRef: 'v1.0.0', repoRoot: root, log: () => {} });
    assert.deepEqual(bumped, []);
    assert.equal(versionOf(root, 'alpha'), '0.1.0');
  } finally {
    rmScratchDir(root);
  }
});

test('run bumps every plugin when there is no previous release', () => {
  const root = makeRepo();
  try {
    const bumped = run({ type: 'patch', repoRoot: root, log: () => {} });
    assert.deepEqual(bumped, ['alpha', 'beta']);
  } finally {
    rmScratchDir(root);
  }
});

test('run rejects an invalid release type', () => {
  assert.throws(() => run({ type: 'nope', log: () => {} }), /Release type must be one of/);
});

test('parseArgs reads type, tag and --root', () => {
  assert.deepEqual(parseArgs(['minor', 'v1.0.0', '--root', '/x']), {
    type: 'minor',
    sinceRef: 'v1.0.0',
    repoRoot: path.resolve('/x'),
  });
});

test('resolveGit honours GIT_BIN and otherwise finds a system git', () => {
  const saved = process.env.GIT_BIN;
  try {
    process.env.GIT_BIN = '/custom/git';
    assert.equal(resolveGit(), '/custom/git');
    delete process.env.GIT_BIN;
    assert.ok(path.isAbsolute(resolveGit()));
  } finally {
    if (saved === undefined) delete process.env.GIT_BIN;
    else process.env.GIT_BIN = saved;
  }
});
