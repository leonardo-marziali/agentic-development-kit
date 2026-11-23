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

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

test('only formatter changes near the changed lines are applied', () => {
  const dir = mkScratchRepo({ 'a.txt': TEN_LINES });
  try {
    const file = writeFile(dir, 'a.txt', TEN_LINES.replace('line5\n', 'edited5\n'));

    const result = formatInScope({ file, formatStdin: upperFormatter, context: 0 });

    assert.strictEqual(result.status, 'narrowed');
    assert.strictEqual(read(file), TEN_LINES.replace('line5\n', 'EDITED5\n'));
  } finally {
    rmScratchDir(dir);
  }
});

test('the context margin widens what gets formatted', () => {
  const dir = mkScratchRepo({ 'a.txt': TEN_LINES });
  try {
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
  } finally {
    rmScratchDir(dir);
  }
});

test('two distant edits format both regions and nothing in between', () => {
  const dir = mkScratchRepo({ 'a.txt': TEN_LINES });
  try {
    const edited = TEN_LINES.replace('line2\n', 'x2\n').replace('line9\n', 'x9\n');
    const file = writeFile(dir, 'a.txt', edited);

    formatInScope({ file, formatStdin: upperFormatter, context: 0 });

    assert.strictEqual(read(file), edited.replace('x2\n', 'X2\n').replace('x9\n', 'X9\n'));
  } finally {
    rmScratchDir(dir);
  }
});

test('a formatter hunk that changes the line count is applied in place', () => {
  const dir = mkScratchRepo({ 'a.txt': 'a\nb\nc\nd\ne\nf\n' });
  try {
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
  } finally {
    rmScratchDir(dir);
  }
});

test('a formatter deletion next to a changed line is applied', () => {
  const dir = mkScratchRepo({ 'a.txt': 'a\nb\nc\nd\n' });
  try {
    const file = writeFile(dir, 'a.txt', 'a\nb\n\n\nc\nd\n');
    // Collapses the doubled blank line the edit introduced.
    const formatStdin = (text) => ({
      ok: true,
      stdout: text.replace('\n\n\n', '\n\n'),
      stderr: '',
    });

    formatInScope({ file, formatStdin, context: 0 });

    assert.strictEqual(read(file), 'a\nb\n\nc\nd\n');
  } finally {
    rmScratchDir(dir);
  }
});

test('a file that differs from HEAD nowhere is left alone', () => {
  const dir = mkScratchRepo({ 'a.txt': TEN_LINES });
  try {
    const file = path.join(dir, 'a.txt');

    const result = formatInScope({ file, formatStdin: upperFormatter });

    assert.strictEqual(result.status, 'unchanged');
    assert.strictEqual(read(file), TEN_LINES);
  } finally {
    rmScratchDir(dir);
  }
});

test('output identical to the input is reported as unchanged', () => {
  const dir = mkScratchRepo({ 'a.txt': 'A\n' });
  try {
    const file = writeFile(dir, 'a.txt', 'A\nB\n');

    const result = formatInScope({ file, formatStdin: upperFormatter });

    assert.strictEqual(result.status, 'unchanged');
    assert.strictEqual(read(file), 'A\nB\n');
  } finally {
    rmScratchDir(dir);
  }
});

test('an untracked file is formatted whole', () => {
  const dir = mkScratchRepo({ 'keep.txt': 'x\n' });
  try {
    const file = writeFile(dir, 'new.txt', 'a\nb\n');

    const result = formatInScope({ file, formatStdin: upperFormatter });

    assert.strictEqual(result.status, 'whole');
    assert.strictEqual(read(file), 'A\nB\n');
  } finally {
    rmScratchDir(dir);
  }
});

test('a file outside any repository is formatted whole', () => {
  const dir = mkScratchDir();
  try {
    const file = writeFile(dir, 'a.txt', 'a\nb\n');

    const result = formatInScope({ file, formatStdin: upperFormatter });

    assert.strictEqual(result.status, 'whole');
    assert.strictEqual(read(file), 'A\nB\n');
  } finally {
    rmScratchDir(dir);
  }
});

test('a formatter failure leaves the file untouched', () => {
  const dir = mkScratchRepo({ 'a.txt': TEN_LINES });
  try {
    const edited = TEN_LINES.replace('line5\n', 'BROKEN\n');
    const file = writeFile(dir, 'a.txt', edited);

    const result = formatInScope({ file, formatStdin: upperFormatter });

    assert.strictEqual(result.status, 'skipped');
    assert.match(result.reason, /syntax error/);
    assert.strictEqual(read(file), edited);
  } finally {
    rmScratchDir(dir);
  }
});

test('a partial result the formatter cannot parse is never written', () => {
  const dir = mkScratchRepo({ 'a.txt': TEN_LINES });
  try {
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
  } finally {
    rmScratchDir(dir);
  }
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
  const dir = mkScratchRepo({ 'a.txt': 'a\nb\nc' });
  try {
    const file = writeFile(dir, 'a.txt', 'a\nb\nedited');
    const formatStdin = (text) => ({ ok: true, stdout: `${text}\n`, stderr: '' });

    formatInScope({ file, formatStdin, context: 0 });

    assert.strictEqual(read(file), 'a\nb\nedited\n');
  } finally {
    rmScratchDir(dir);
  }
});

test('the session base is diffed against instead of HEAD when given', () => {
  const dir = mkScratchRepo({ 'a.txt': TEN_LINES });
  try {
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
  } finally {
    rmScratchDir(dir);
  }
});
