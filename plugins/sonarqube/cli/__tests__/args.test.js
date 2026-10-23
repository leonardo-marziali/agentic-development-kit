'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, UsageError } = require('../args');

test('files takes paths and defaults to text output at a HIGH threshold', () => {
  const parsed = parseArgs(['files', 'a.js', 'src/b.py']);
  assert.equal(parsed.command, 'files');
  assert.deepEqual(parsed.paths, ['a.js', 'src/b.py']);
  assert.equal(parsed.options.format, 'text');
  assert.equal(parsed.options.minSeverity, 'HIGH');
  assert.equal(parsed.options.timeoutMs, 120_000);
});

test('options accept both --name value and --name=value, anywhere on the line', () => {
  const parsed = parseArgs([
    '--format=json',
    'files',
    'a.js',
    '--min-severity',
    'blocker',
    '--timeout',
    '5',
  ]);
  assert.equal(parsed.options.format, 'json');
  assert.equal(parsed.options.minSeverity, 'BLOCKER');
  assert.equal(parsed.options.timeoutMs, 5000);
});

test('-- ends option parsing, so a file named like a flag is still a path', () => {
  assert.deepEqual(parseArgs(['files', '--', '--verbose']).paths, ['--verbose']);
});

test('both severity vocabularies are accepted as a threshold', () => {
  for (const level of ['CRITICAL', 'high', 'MAJOR', 'medium', 'minor', 'LOW', 'INFO']) {
    assert.equal(
      parseArgs(['files', 'a', '--min-severity', level]).options.minSeverity,
      level.toUpperCase(),
    );
  }
});

test('stdin needs a virtual path; --lang is upper-cased', () => {
  assert.throws(() => parseArgs(['stdin']), UsageError);
  const parsed = parseArgs(['stdin', '--path', 'src/x.ts', '--lang', 'ts']);
  assert.equal(parsed.options.path, 'src/x.ts');
  assert.equal(parsed.options.lang, 'TS');
});

test('daemon needs a known action', () => {
  assert.equal(parseArgs(['daemon', 'status']).action, 'status');
  assert.throws(() => parseArgs(['daemon']), UsageError);
  assert.throws(() => parseArgs(['daemon', 'restart']), UsageError);
});

test('help wins over everything else', () => {
  assert.equal(parseArgs(['files', '--help']).command, 'help');
  assert.equal(parseArgs(['-h']).command, 'help');
});

test('invalid input is a UsageError naming the problem', () => {
  const cases = [
    [[], /no command/],
    [['lint'], /unknown command "lint"/],
    [['files'], /at least one path/],
    [['files', 'a', '--format', 'xml'], /json or text/],
    [['files', 'a', '--min-severity', 'severe'], /unknown level "severe"/],
    [['files', 'a', '--timeout', '0'], /positive/],
    [['files', 'a', '--bogus'], /unknown option --bogus/],
    [['files', 'a', '--format'], /needs a value/],
    [['doctor', 'extra'], /unexpected argument "extra"/],
  ];
  for (const [argv, message] of cases) {
    assert.throws(
      () => parseArgs(argv),
      (error) => error instanceof UsageError && message.test(error.message),
      argv.join(' '),
    );
  }
});
