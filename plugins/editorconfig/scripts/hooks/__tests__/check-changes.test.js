'use strict';

/*
scripts/check-changes.js: the Stop hook's EditorConfig check as a standalone
command, through the real `editorconfig-checker` (and a fake ./mvnw for the
ec4j path, as in check-and-loop.test.js). Each verdict is compared with what
the hook decides on the same fixture, so the two can't drift.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { newSession, runHook, touch } = require('./helpers');

const CLI = path.join(__dirname, '..', '..', 'check-changes.js');

const EDITORCONFIG = [
  'root = true',
  '[*]',
  'indent_style = space',
  'indent_size = 2',
  'end_of_line = lf',
  'trim_trailing_whitespace = true',
  'insert_final_newline = true',
  '',
].join('\n');

// A tab-indented line (not auto-fixable) far above the lines the tests edit.
const LINES = ['first', '\told tab'];
for (let i = 1; i <= 20; i += 1) LINES.push(`line ${i}`);
const ORIGINAL = `${LINES.join('\n')}\n`;

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function setup(t, contents = ORIGINAL) {
  const ctx = newSession(t);
  fs.writeFileSync(path.join(ctx.project, '.editorconfig'), EDITORCONFIG);
  const file = path.join(ctx.project, 'a.txt');
  fs.writeFileSync(file, contents);
  git(ctx.project, 'init', '-q');
  git(ctx.project, 'add', '-A');
  git(ctx.project, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'init');
  return { ...ctx, file };
}

function cli(ctx, args, env = {}) {
  const result = spawnSync('node', [CLI, ...args], {
    cwd: ctx.project,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }
  return { ...result, json };
}

// The hook's verdict on the same file: 'block' or 'pass'.
function hookVerdict(ctx, file = ctx.file) {
  touch(ctx, file);
  const res = runHook('check-and-loop.js', ctx, { hook_event_name: 'Stop' });
  return res.json?.decision === 'block' ? 'block' : 'pass';
}

test('a pre-existing violation out of scope does not block, and --fix leaves the file', (t) => {
  const ctx = setup(t);
  const text = ORIGINAL.replace('line 15', 'line fifteen  ');
  fs.writeFileSync(ctx.file, text);

  const res = cli(ctx, ['--fix', '--format', 'json', '--', ctx.file]);

  // The trailing spaces are in scope, but the file also has the old tab.
  assert.equal(res.status, 1, res.stderr);
  assert.deepEqual(
    res.json.findings.map((f) => [f.file, f.line]),
    [[ctx.file, 17]],
  );
  assert.deepEqual(res.json.outOfScope, [{ file: ctx.file, count: 1 }]);
  assert.deepEqual(res.json.fixed, []);
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), text);
  assert.equal(hookVerdict(ctx), 'block');
});

test('an edit elsewhere in a file with old violations passes, as in the hook', (t) => {
  const ctx = setup(t);
  fs.writeFileSync(ctx.file, ORIGINAL.replace('line 15', 'line fifteen'));

  const res = cli(ctx, ['--format', 'json', '--', ctx.file]);

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json.findings, []);
  assert.deepEqual(res.json.outOfScope, [{ file: ctx.file, count: 1 }]);
  assert.equal(hookVerdict(ctx), 'pass');
});

test('a new violation in scope blocks; text output is the hook report', (t) => {
  const ctx = setup(t);
  fs.writeFileSync(ctx.file, ORIGINAL.replace('line 15', '\tline 15'));

  const res = cli(ctx, ['--', ctx.file]);

  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stdout, /^a\.txt:17: .*indent/m);
  assert.match(res.stderr, /1 pre-existing violation/);
  assert.equal(hookVerdict(ctx), 'block');
});

test('without --fix nothing is written; with --fix the checker fixes it', (t) => {
  const clean = ORIGINAL.replace('\told tab', '  old tab');
  const ctx = setup(t, clean);
  const dirty = clean.replace('line 15', 'line 15  ');
  fs.writeFileSync(ctx.file, dirty);

  const check = cli(ctx, ['--format', 'json', '--', ctx.file]);
  assert.equal(check.status, 1, check.stderr);
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), dirty, 'a check must not write');

  const fix = cli(ctx, ['--fix', '--format', 'json', '--', ctx.file]);
  assert.equal(fix.status, 0, fix.stderr);
  assert.deepEqual(fix.json.fixed, [ctx.file]);
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), clean);

  fs.writeFileSync(ctx.file, dirty);
  assert.equal(hookVerdict(ctx), 'pass');
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), clean, 'the hook fixes it the same way');
});

test('an untracked file is checked whole', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.project, 'new.txt');
  fs.writeFileSync(file, '\tindented\n');

  const res = cli(ctx, ['--format', 'json', '--', file]);

  assert.equal(res.status, 1, res.stderr);
  assert.equal(res.json.findings.length, 1);
  assert.equal(hookVerdict(ctx, file), 'block');
});

test(
  '--fix formats through ec4j where the build declares it',
  { skip: process.platform === 'win32' },
  (t) => {
    const ctx = setup(t);
    fs.writeFileSync(
      path.join(ctx.project, 'pom.xml'),
      '<project><artifactId>editorconfig-maven-plugin</artifactId></project>\n',
    );
    // A stand-in ./mvnw: reports one violation until a format run clears it.
    fs.writeFileSync(
      path.join(ctx.project, 'mvnw'),
      [
        '#!/bin/sh',
        'echo "$*" >> calls.log',
        'case "$*" in *ormat*) rm -f check-output.txt; exit 0;; esac',
        '[ -f check-output.txt ] || exit 0',
        'cat check-output.txt',
        'exit 1',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );
    const file = path.join(ctx.project, 'new.txt');
    fs.writeFileSync(file, 'x\n');
    fs.writeFileSync(
      path.join(ctx.project, 'check-output.txt'),
      '[ERROR] new.txt@1,1: Delete 1 character - violates trim_trailing_whitespace = true, reported by TextLinter\n',
    );

    assert.equal(cli(ctx, ['--', file]).status, 1);
    const res = cli(ctx, ['--fix', '--', file]);

    assert.equal(res.status, 0, res.stderr);
    const log = fs.readFileSync(path.join(ctx.project, 'calls.log'), 'utf8').trim().split('\n');
    assert.deepEqual(
      log.map((line) => line.split(' ').at(-1)),
      ['editorconfig:check', 'editorconfig:check', 'editorconfig:format', 'editorconfig:check'],
    );
  },
);

test('files no .editorconfig applies to are ignored', (t) => {
  const ctx = newSession(t);
  const file = path.join(ctx.project, 'a.txt');
  fs.writeFileSync(file, '\tx\n');

  const res = cli(ctx, ['--format', 'json', '--', file]);

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json.checked, []);
});

/*
editorconfig-checker installed beside node is found before anything on PATH,
so there the fake below can't stand in for it.
*/
const REAL_CHECKER_BESIDE_NODE = fs.existsSync(
  path.join(path.dirname(process.execPath), 'editorconfig-checker'),
);

test(
  'a checker that cannot run is exit 2, never clean',
  { skip: REAL_CHECKER_BESIDE_NODE || process.platform === 'win32' },
  (t) => {
    const ctx = setup(t);
    fs.writeFileSync(ctx.file, ORIGINAL.replace('line 15', 'line fifteen'));
    const bin = path.join(path.dirname(ctx.project), 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, 'editorconfig-checker'),
      '#!/bin/sh\necho "cannot download" >&2\nexit 1\n',
      { mode: 0o755 },
    );

    const res = cli(ctx, ['--format', 'json', '--', ctx.file], {
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    });

    assert.equal(res.status, 2, res.stdout);
    assert.match(res.json.warnings.join('\n'), /could not run.*cannot download/s);
  },
);
