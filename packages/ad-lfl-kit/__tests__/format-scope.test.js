'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { formatInScope } = require('../format-scope');
const { mkScratchDir, rmScratchDir, writeFile, mkScratchRepo } = require('./helpers');

/*
 * A stand-in formatter: upper-cases every line. Every line it touches comes
 * back as its own hunk, which is what a test needs to see which ones were
 * applied. `ok: false` when the text contains `BROKEN`, standing in for a
 * formatter that can't parse its input.
 */
function upperFormatter(text) {
  if (text.includes('BROKEN')) return { ok: false, stdout: '', stderr: 'syntax error' };
  return { ok: true, stdout: text.toUpperCase(), stderr: '' };
}

const TEN_LINES = Array.from({ length: 10 }, (_, i) => `line${i + 1}\n`).join('');

// Runs `fn` in a scratch repo with `files` committed, then removes it.
function withRepo(files, fn) {
  const dir = mkScratchRepo(files);
  try {
    return fn(dir);
  } finally {
    rmScratchDir(dir);
  }
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('only formatter changes near the changed lines are applied', () => {
  withRepo({ 'a.txt': TEN_LINES }, (dir) => {
    const file = writeFile(dir, 'a.txt', TEN_LINES.replace('line5\n', 'edited5\n'));

    const result = formatInScope({ file, formatStdin: upperFormatter, context: 0 });

    assert.strictEqual(result.status, 'narrowed');
    assert.strictEqual(read(file), TEN_LINES.replace('line5\n', 'EDITED5\n'));
  });
});

test('the context margin widens what gets formatted', () => {
  withRepo({ 'a.txt': TEN_LINES }, (dir) => {
    const file = writeFile(dir, 'a.txt', TEN_LINES.replace('line5\n', 'edited5\n'));

    formatInScope({ file, formatStdin: upperFormatter });

    const lines = read(file).split('\n');
    assert.deepStrictEqual(lines.slice(0, 8), [
      'line1',
      'line2',
      'LINE3',
      'LINE4',
      'EDITED5',
      'LINE6',
      'LINE7',
      'line8',
    ]);
  });
});

test('two distant edits format both regions and nothing in between', () => {
  withRepo({ 'a.txt': TEN_LINES }, (dir) => {
    const edited = TEN_LINES.replace('line2\n', 'x2\n').replace('line9\n', 'x9\n');
    const file = writeFile(dir, 'a.txt', edited);

    formatInScope({ file, formatStdin: upperFormatter, context: 0 });

    assert.strictEqual(read(file), edited.replace('x2\n', 'X2\n').replace('x9\n', 'X9\n'));
  });
});

test('a formatter hunk that changes the line count is applied in place', () => {
  withRepo({ 'a.txt': 'a\nb\nc\nd\ne\nf\n' }, (dir) => {
    const file = writeFile(dir, 'a.txt', 'a\nb\nc\nd\nEDIT\nf\n');
    // Splits line 5 in two, and splits line 1 in two (out of scope).
    const formatStdin = (text) => ({
      ok: true,
      stdout: text.replace('EDIT\n', 'ED\nIT\n').replace(/^a\n/, 'a1\na2\n'),
      stderr: '',
    });

    const result = formatInScope({ file, formatStdin, context: 0 });

    assert.strictEqual(result.status, 'narrowed');
    assert.strictEqual(read(file), 'a\nb\nc\nd\nED\nIT\nf\n');
  });
});

test('a formatter deletion next to a changed line is applied', () => {
  withRepo({ 'a.txt': 'a\nb\nc\nd\n' }, (dir) => {
    const file = writeFile(dir, 'a.txt', 'a\nb\n\n\nc\nd\n');
    // Collapses the doubled blank line the edit introduced.
    const formatStdin = (text) => ({
      ok: true,
      stdout: text.replace('\n\n\n', '\n\n'),
      stderr: '',
    });

    formatInScope({ file, formatStdin, context: 0 });

    assert.strictEqual(read(file), 'a\nb\n\nc\nd\n');
  });
});

test('a file that differs from HEAD nowhere is left alone', () => {
  withRepo({ 'a.txt': TEN_LINES }, (dir) => {
    const file = path.join(dir, 'a.txt');

    const result = formatInScope({ file, formatStdin: upperFormatter });

    assert.strictEqual(result.status, 'unchanged');
    assert.strictEqual(read(file), TEN_LINES);
  });
});

test('output identical to the input is reported as unchanged', () => {
  withRepo({ 'a.txt': 'A\n' }, (dir) => {
    const file = writeFile(dir, 'a.txt', 'A\nB\n');

    const result = formatInScope({ file, formatStdin: upperFormatter });

    assert.strictEqual(result.status, 'unchanged');
    assert.strictEqual(read(file), 'A\nB\n');
  });
});

for (const [where, makeDir, name] of [
  ['an untracked file', () => mkScratchRepo({ 'keep.txt': 'x\n' }), 'new.txt'],
  ['a file outside any repository', () => mkScratchDir(), 'a.txt'],
]) {
  test(`${where} is formatted whole`, () => {
    const dir = makeDir();
    try {
      const file = writeFile(dir, name, 'a\nb\n');

      const result = formatInScope({ file, formatStdin: upperFormatter });

      assert.strictEqual(result.status, 'whole');
      assert.strictEqual(read(file), 'A\nB\n');
    } finally {
      rmScratchDir(dir);
    }
  });
}

test('a formatter failure leaves the file untouched', () => {
  withRepo({ 'a.txt': TEN_LINES }, (dir) => {
    const edited = TEN_LINES.replace('line5\n', 'BROKEN\n');
    const file = writeFile(dir, 'a.txt', edited);

    const result = formatInScope({ file, formatStdin: upperFormatter });

    assert.strictEqual(result.status, 'skipped');
    assert.match(result.reason, /syntax error/);
    assert.strictEqual(read(file), edited);
  });
});

test('a partial result the formatter cannot parse is never written', () => {
  withRepo({ 'a.txt': TEN_LINES }, (dir) => {
    const edited = TEN_LINES.replace('line5\n', 'edited5\n');
    const file = writeFile(dir, 'a.txt', edited);
    let calls = 0;
    const formatStdin = (text) => {
      calls += 1;
      // The second call is the safety re-check on the partial result.
      return calls === 1 ? upperFormatter(text) : { ok: false, stdout: '', stderr: 'bad partial' };
    };

    const result = formatInScope({ file, formatStdin, context: 0 });

    assert.strictEqual(result.status, 'skipped');
    assert.match(result.reason, /bad partial/);
    assert.strictEqual(read(file), edited);
  });
});

test('CRLF line endings are preserved on lines that are not formatted', () => {
  const crlf = 'one\r\ntwo\r\nthree\r\nfour\r\nfive\r\n';
  const dir = mkScratchRepo({ 'a.txt': crlf });
  try {
    const file = writeFile(dir, 'a.txt', crlf.replace('five', 'edited'));

    formatInScope({ file, formatStdin: upperFormatter, context: 0 });

    assert.strictEqual(read(file), 'one\r\ntwo\r\nthree\r\nfour\r\nEDITED\r\n');
  } finally {
    rmScratchDir(dir);
  }
});

test('a final newline the formatter adds to a changed last line is kept', () => {
  withRepo({ 'a.txt': 'a\nb\nc' }, (dir) => {
    const file = writeFile(dir, 'a.txt', 'a\nb\nedited');
    const formatStdin = (text) => ({ ok: true, stdout: `${text}\n`, stderr: '' });

    formatInScope({ file, formatStdin, context: 0 });

    assert.strictEqual(read(file), 'a\nb\nedited\n');
  });
});

test('the session base is diffed against instead of HEAD when given', () => {
  withRepo({ 'a.txt': TEN_LINES }, (dir) => {
    const { execFileSync } = require('node:child_process');
    const git = (...args) =>
      execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe', encoding: 'utf8' });
    const base = git('rev-parse', 'HEAD').trim();
    // The session commits its edit, so HEAD alone would show no change.
    writeFile(dir, 'a.txt', TEN_LINES.replace('line5\n', 'edited5\n'));
    git(
      '-c',
      'user.email=test@example.com',
      '-c',
      'user.name=Test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '--no-verify',
      '-am',
      'edit',
    );
    const file = path.join(dir, 'a.txt');

    const result = formatInScope({
      file,
      formatStdin: upperFormatter,
      bases: { [dir]: base },
      context: 0,
    });

    assert.strictEqual(result.status, 'narrowed');
    assert.strictEqual(read(file), TEN_LINES.replace('line5\n', 'EDITED5\n'));
  });
});
