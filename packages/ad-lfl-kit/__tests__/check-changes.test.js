'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { CHECK_CHANGES_USAGE, parseCheckChangesArgs, runCheckChanges } = require('../check-changes');
const { mkScratchDir, rmScratchDir, writeFile, mkScratchRepo } = require('./helpers');

function sink() {
  const chunks = [];
  return { write: (chunk) => chunks.push(String(chunk)), text: () => chunks.join('') };
}

/*
 * Runs the command with `check` standing in for a plugin's, and records the
 * calls it gets. `matches` takes .txt files.
 */
function run(argv, check = () => ({})) {
  const calls = [];
  const stdout = sink();
  const stderr = sink();
  const command = {
    plugin: 'demo',
    matches: (file) => file.endsWith('.txt'),
    check: (files, options) => {
      calls.push({ files, options });
      return check(files, options);
    },
  };
  const code = runCheckChanges(command, argv, { stdout, stderr });
  let json;
  try {
    json = JSON.parse(stdout.text());
  } catch {
    json = undefined;
  }
  return { code, calls, stdout: stdout.text(), stderr: stderr.text(), json };
}

function scratch(t, files) {
  const dir = files ? mkScratchRepo(files) : fs.realpathSync(mkScratchDir());
  t.after(() => rmScratchDir(dir));
  return dir;
}

function head(dir) {
  return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

const FINDING = (file, line) => ({ file, line, rule: 'R1', message: 'bad', severity: 'error' });

test('parseCheckChangesArgs reads the flags, both value spellings, and the paths', () => {
  assert.deepStrictEqual(parseCheckChangesArgs([]), {
    fix: false,
    format: 'text',
    ref: null,
    paths: [],
  });
  assert.deepStrictEqual(
    parseCheckChangesArgs(['--fix', '--format=json', '--ref', 'main', 'a', '--', '-b', '--fix']),
    { fix: true, format: 'json', ref: 'main', paths: ['a', '-b', '--fix'] },
  );
  assert.strictEqual(parseCheckChangesArgs(['--ref=a=b']).ref, 'a=b');
});

test('parseCheckChangesArgs rejects unknown options, missing values and bad formats', () => {
  assert.throws(() => parseCheckChangesArgs(['--fixx']), /unknown option --fixx/);
  assert.throws(() => parseCheckChangesArgs(['--fix=yes']), /unknown option --fix=yes/);
  assert.throws(() => parseCheckChangesArgs(['--ref']), /--ref needs a value/);
  assert.throws(() => parseCheckChangesArgs(['--format=']), /--format needs a value/);
  assert.throws(() => parseCheckChangesArgs(['--format', 'xml']), /json or text, not xml/);
});

test('a usage error is exit 2 with the usage line, and nothing is checked', () => {
  const res = run(['--bogus']);

  assert.strictEqual(res.code, 2);
  assert.match(res.stderr, /^demo plugin: unknown option --bogus\n/);
  assert.ok(res.stderr.includes(CHECK_CHANGES_USAGE));
  assert.deepStrictEqual(res.calls, []);
});

test('paths that do not exist, are not files or do not match are ignored', (t) => {
  const dir = scratch(t);
  const other = writeFile(dir, 'a.md', 'x\n');

  const res = run(['--format', 'json', '--', other, dir, path.join(dir, 'gone.txt')]);

  assert.strictEqual(res.code, 0);
  assert.deepStrictEqual(res.calls, []);
  assert.deepStrictEqual(res.json, {
    plugin: 'demo',
    checked: [],
    fixed: [],
    findings: [],
    outOfScope: [],
    warnings: [],
  });
});

test('paths are resolved against the cwd and deduplicated', (t) => {
  const dir = scratch(t);
  const file = writeFile(dir, 'a.txt', 'x\n');

  const res = run(['--format=json', path.relative(process.cwd(), file), file]);

  assert.deepStrictEqual(res.json.checked, [file]);
  assert.deepStrictEqual(res.calls[0].files, [file]);
});

test('findings are exit 1; out-of-scope ones are counted per file', (t) => {
  const dir = scratch(t);
  const a = writeFile(dir, 'a.txt', 'x\n');
  const b = writeFile(dir, 'b.txt', 'x\n');

  const res = run(['--format', 'json', '--', a, b], () => ({
    findings: [FINDING(a, 3)],
    outOfScope: [{ file: a }, { file: b }, { file: a }],
    notes: ['a note'],
  }));

  assert.strictEqual(res.code, 1);
  assert.deepStrictEqual(res.json.findings, [FINDING(a, 3)]);
  assert.deepStrictEqual(res.json.outOfScope, [
    { file: a, count: 2 },
    { file: b, count: 1 },
  ]);
  assert.deepStrictEqual(res.json.warnings, ['a note']);
  assert.strictEqual(res.stderr, '');
});

test('a failure is exit 2 even beside findings, and is listed in the warnings', (t) => {
  const dir = scratch(t);
  const a = writeFile(dir, 'a.txt', 'x\n');

  const res = run(['--format', 'json', '--', a], () => ({
    findings: [FINDING(a, 1)],
    notes: ['a note'],
    failures: ['tool missing'],
  }));

  assert.strictEqual(res.code, 2);
  assert.deepStrictEqual(res.json.warnings, ['a note', 'tool missing']);
});

test('a check that throws is exit 2, never clean', (t) => {
  const dir = scratch(t);
  const a = writeFile(dir, 'a.txt', 'x\n');

  const res = run(['--', a], () => {
    throw new Error('boom');
  });

  assert.strictEqual(res.code, 2);
  assert.strictEqual(res.stdout, '');
  assert.strictEqual(res.stderr, 'demo plugin: the check could not run: boom\n');
});

test('text output is the report on stdout and the warnings on stderr', (t) => {
  const dir = scratch(t);
  const a = writeFile(dir, 'a.txt', 'x\n');

  const blocked = run(['--', a], () => ({
    findings: [FINDING(a, 1)],
    report: '- a.txt:1 R1 bad',
    notes: ['a note'],
  }));
  assert.strictEqual(blocked.code, 1);
  assert.strictEqual(blocked.stdout, '- a.txt:1 R1 bad\n');
  assert.strictEqual(blocked.stderr, 'demo plugin: a note\n');

  const clean = run(['--', a]);
  assert.strictEqual(clean.code, 0);
  assert.strictEqual(clean.stdout, '');
});

test('--fix reaches the check, and `fixed` lists only the files it changed', (t) => {
  const dir = scratch(t);
  const a = writeFile(dir, 'a.txt', 'x\n');
  const b = writeFile(dir, 'b.txt', 'x\n');

  const res = run(['--fix', '--format', 'json', '--', a, b], (files, { fix }) => {
    if (fix) fs.writeFileSync(b, 'fixed\n');
    return {};
  });

  assert.strictEqual(res.code, 0);
  assert.strictEqual(res.calls[0].options.fix, true);
  assert.deepStrictEqual(res.json.fixed, [b]);

  const check = run(['--format', 'json', '--', a]);
  assert.strictEqual(check.calls[0].options.fix, false);
  assert.deepStrictEqual(check.json.fixed, []);
});

test('the bases default to HEAD in each repository holding a file', (t) => {
  const repo = scratch(t, { 'a.txt': 'x\n' });
  const loose = scratch(t);
  const outside = writeFile(loose, 'b.txt', 'x\n');

  const res = run(['--', path.join(repo, 'a.txt'), outside]);

  assert.deepStrictEqual([...res.calls[0].options.bases], [[repo, head(repo)]]);
});

test('--ref resolves to that commit; one that does not resolve is exit 2', (t) => {
  const repo = scratch(t, { 'a.txt': 'x\n' });
  const file = path.join(repo, 'a.txt');

  const res = run(['--ref', 'main', '--', file]);
  assert.deepStrictEqual([...res.calls[0].options.bases], [[repo, head(repo)]]);

  const bad = run(['--ref', 'HEAD~1', '--', file]);
  assert.strictEqual(bad.code, 2);
  assert.match(bad.stderr, /--ref HEAD~1 does not name a commit in /);
  assert.deepStrictEqual(bad.calls, []);
});

test('a repository with no commits has no base by default, so files are checked whole', (t) => {
  const dir = scratch(t);
  execFileSync('git', ['-C', dir, 'init', '--quiet']);
  const file = writeFile(dir, 'a.txt', 'x\n');

  const res = run(['--', file]);

  assert.strictEqual(res.code, 0);
  assert.deepStrictEqual([...res.calls[0].options.bases], []);
  assert.strictEqual(run(['--ref', 'HEAD', '--', file]).code, 2);
});
