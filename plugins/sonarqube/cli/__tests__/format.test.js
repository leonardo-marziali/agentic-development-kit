'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { buildResult, render, exitCodeFor, displayPathFrom } = require('../format');

const CWD = path.resolve('/work/project');
const abs = (rel) => path.join(CWD, rel);

function raw(rel, ruleKey, severity, line, extra = {}) {
  return {
    ruleKey,
    primaryMessage: `${ruleKey} message`,
    fileUri: pathToFileURL(abs(rel)).href,
    severity,
    type: 'CODE_SMELL',
    textRange: { startLine: line, endLine: line + 1 },
    quickFixes: [],
    ...extra,
  };
}

const ISSUES = [
  raw('src/b.js', 'javascript:S1481', 'MINOR', 9),
  raw('src/a.py', 'python:S5754', 'CRITICAL', 4, { quickFixes: [{ message: 'fix' }] }),
  raw('.env', 'secrets:S6290', 'BLOCKER', 2),
  raw('src/a.py', 'python:S1', 'MINOR', 1),
];

function result(minSeverity = 'HIGH') {
  return buildResult({
    issues: ISSUES,
    analyzed: [
      abs('src/a.py'),
      abs('src/b.js'),
      abs('.env'),
      abs('src/clean1.js'),
      abs('src/clean2.js'),
    ],
    skipped: [{ file: abs('gone.js'), reason: 'not found' }],
    minSeverity,
    cwd: CWD,
  });
}

test('records have the documented fields, sorted by severity then file then line', () => {
  const { issues } = result();
  assert.deepEqual(Object.keys(issues[0]).sort(), [
    'endLine',
    'file',
    'hasQuickFix',
    'line',
    'message',
    'rule',
    'severity',
    'type',
  ]);
  assert.deepEqual(
    issues.map((i) => `${i.severity} ${i.file}:${i.line}`),
    ['BLOCKER .env:2', 'CRITICAL src/a.py:4', 'MINOR src/a.py:1', 'MINOR src/b.js:9'],
  );
  assert.equal(issues[1].hasQuickFix, true);
  assert.equal(issues[1].endLine, 5);
});

test('clean files are a count, never listed', () => {
  const r = result();
  assert.equal(r.summary.clean, 2);
  assert.equal(r.summary.withIssues, 3);
  const text = render(r, 'text');
  assert.doesNotMatch(text, /clean1|clean2/);
  assert.match(
    text,
    /5 file\(s\) analyzed, 2 clean, 4 issue\(s\) in 3 file\(s\), 2 at\/above HIGH/,
  );
});

test('exit code follows the threshold', () => {
  assert.equal(exitCodeFor(result('HIGH')), 1);
  assert.equal(
    exitCodeFor(buildResult({ issues: [ISSUES[0]], analyzed: [], minSeverity: 'HIGH', cwd: CWD })),
    0,
  );
  assert.equal(
    exitCodeFor(buildResult({ issues: [], analyzed: [abs('x')], minSeverity: 'INFO', cwd: CWD })),
    0,
  );
});

test('text output is one line per issue plus a summary and the skips', () => {
  const lines = render(result(), 'text').trim().split('\n');
  assert.equal(lines[0], '.env:2  BLOCKER  secrets:S6290  secrets:S6290 message');
  assert.match(lines[1], /\(quick fix available\)$/);
  assert.equal(lines.at(-1), 'skipped gone.js: not found');
});

test('json output parses back to the same result', () => {
  const r = result();
  assert.deepEqual(JSON.parse(render(r, 'json')), r);
});

test('paths outside the cwd stay absolute', () => {
  const display = displayPathFrom(CWD);
  const outside = path.resolve('/elsewhere/x.js');
  assert.equal(display(outside), outside);
  assert.equal(display(abs('a/b.js')), 'a/b.js');
});
