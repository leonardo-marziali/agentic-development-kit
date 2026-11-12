'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchDir, rmScratchDir, installedEngine, SKIP_WITHOUT_JDK } = require('./helpers');
const { runEngine } = require('../engine');
const { DEFAULT_PROFILE } = require('../profile');

const FIXTURES = path.join(__dirname, 'fixtures', 'format');

function scratch(t) {
  const dir = mkScratchDir();
  t.after(() => rmScratchDir(dir));
  return dir;
}

function copyFixture(dir, name, { crlf = false } = {}) {
  const dest = path.join(dir, name);
  let text = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
  if (crlf) text = text.replaceAll('\n', '\r\n');
  fs.writeFileSync(dest, text);
  return dest;
}

// A fake engine: records its arguments and request, prints canned lines.
function fakeEngine(dir, lines) {
  const script = path.join(dir, 'fake-engine.js');
  fs.writeFileSync(
    script,
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
const request = fs.readFileSync(args[args.indexOf('--request') + 1], 'utf8');
fs.writeFileSync(${JSON.stringify(path.join(dir, 'call.json'))}, JSON.stringify({ args, request }));
process.stdout.write(${JSON.stringify(lines.join('\n') + '\n')});
`,
  );
  fs.chmodSync(script, 0o755);
  return {
    env: { JAVA_PLUGIN_ENGINE_CMD: script },
    call: () => JSON.parse(fs.readFileSync(path.join(dir, 'call.json'), 'utf8')),
  };
}

test('writes the request as tab-separated lines and passes the options', (t) => {
  const dir = scratch(t);
  const engine = fakeEngine(dir, []);
  const withSpace = path.join(dir, 'with space', 'A.java');

  runEngine({
    manifest: null,
    files: [
      {
        path: withSpace,
        ranges: [
          [3, 4],
          [9, 9],
        ],
      },
      { path: '/x/B.java', ranges: '*' },
      { path: '/x/C.java', ranges: null },
    ],
    profile: '/p/eclipse.xml',
    rules: true,
    disabled: ['S3', 'J16'],
    source: 8,
    boot: { major: 2, minor: 7 },
    nullness: 'spring',
    env: engine.env,
  });

  const { args, request } = engine.call();
  assert.equal(request, `${withSpace}\t3-4,9-9\n/x/B.java\t*\n/x/C.java\t-\n`);
  assert.deepEqual(args.slice(args.indexOf('--profile'), args.indexOf('--profile') + 2), [
    '--profile',
    '/p/eclipse.xml',
  ]);
  for (const [flag, value] of [
    ['--rules', 'on'],
    ['--disabled', 'S3,J16'],
    ['--source', '8'],
    ['--boot', '2.7'],
    ['--nullness', 'spring'],
  ]) {
    assert.equal(args[args.indexOf(flag) + 1], value, flag);
  }
});

test('passes --boot none and --rules off when there is no Boot and no rules', (t) => {
  const dir = scratch(t);
  const engine = fakeEngine(dir, []);
  runEngine({
    manifest: null,
    files: [{ path: '/x/A.java', ranges: '*' }],
    profile: null,
    rules: false,
    source: 17,
    boot: null,
    env: engine.env,
  });
  const { args } = engine.call();
  assert.equal(args[args.indexOf('--boot') + 1], 'none');
  assert.equal(args[args.indexOf('--rules') + 1], 'off');
  assert.equal(args.includes('--profile'), false);
});

test('parses formatted files, findings and errors', (t) => {
  const dir = scratch(t);
  const engine = fakeEngine(dir, [
    'FORMATTED\t/x/A.java',
    'FINDING\t/x/A.java\t12\tJ16\tWildcard import java.util.*',
    'ERROR\t/x/B.java\tcould not be formatted (syntax error?)',
    'some stray log line',
  ]);

  const result = runEngine({
    manifest: null,
    files: [{ path: '/x/A.java', ranges: '*' }],
    source: 17,
    env: engine.env,
  });

  assert.deepEqual(result, {
    formatted: ['/x/A.java'],
    findings: [
      { file: '/x/A.java', line: 12, rule: 'J16', message: 'Wildcard import java.util.*' },
    ],
    errors: [{ path: '/x/B.java', message: 'could not be formatted (syntax error?)' }],
  });
});

test('reports an engine that cannot start as one error, not a throw', (t) => {
  const result = runEngine({
    manifest: null,
    files: [{ path: '/x/A.java', ranges: '*' }],
    source: 17,
    env: { JAVA_PLUGIN_ENGINE_CMD: path.join(scratch(t), 'missing-engine') },
  });
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].path, '-');
});

test(
  'real engine: formats only the requested line range',
  { skip: SKIP_WITHOUT_JDK },
  async (t) => {
    const manifest = await installedEngine();
    const dir = scratch(t);
    const file = copyFixture(dir, 'Messy.java');

    const result = runEngine({
      manifest,
      files: [{ path: file, ranges: [[4, 4]] }],
      profile: DEFAULT_PROFILE,
      source: 17,
    });

    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.formatted, [file]);
    assert.equal(
      fs.readFileSync(file, 'utf8'),
      fs.readFileSync(path.join(FIXTURES, 'Messy.expected-range.java'), 'utf8'),
    );
  },
);

test('real engine: formats the whole file with *', { skip: SKIP_WITHOUT_JDK }, async (t) => {
  const manifest = await installedEngine();
  const dir = scratch(t);
  const file = copyFixture(dir, 'Messy.java');

  runEngine({
    manifest,
    files: [{ path: file, ranges: '*' }],
    profile: DEFAULT_PROFILE,
    source: 17,
  });

  assert.equal(
    fs.readFileSync(file, 'utf8'),
    fs.readFileSync(path.join(FIXTURES, 'Messy.expected-full.java'), 'utf8'),
  );
});

test(
  "real engine: the default profile follows the author's IntelliJ style",
  { skip: SKIP_WITHOUT_JDK },
  async (t) => {
    const manifest = await installedEngine();
    const file = copyFixture(scratch(t), 'Style.java');

    runEngine({
      manifest,
      files: [{ path: file, ranges: '*' }],
      profile: DEFAULT_PROFILE,
      source: 21,
    });

    assert.equal(
      fs.readFileSync(file, 'utf8'),
      fs.readFileSync(path.join(FIXTURES, 'Style.expected.java'), 'utf8'),
    );
  },
);

test('real engine: keeps CRLF line endings', { skip: SKIP_WITHOUT_JDK }, async (t) => {
  const manifest = await installedEngine();
  const dir = scratch(t);
  const file = copyFixture(dir, 'Messy.java', { crlf: true });

  runEngine({
    manifest,
    files: [{ path: file, ranges: [[4, 4]] }],
    profile: DEFAULT_PROFILE,
    source: 17,
  });

  const expected = fs
    .readFileSync(path.join(FIXTURES, 'Messy.expected-range.java'), 'utf8')
    .replaceAll('\n', '\r\n');
  assert.equal(fs.readFileSync(file, 'utf8'), expected);
});

test(
  'real engine: reports a broken file and still formats the others',
  { skip: SKIP_WITHOUT_JDK },
  async (t) => {
    const manifest = await installedEngine();
    const dir = scratch(t);
    const broken = copyFixture(dir, 'Broken.java');
    const messy = copyFixture(dir, 'Messy.java');
    const before = fs.readFileSync(broken, 'utf8');

    const result = runEngine({
      manifest,
      files: [
        { path: broken, ranges: '*' },
        { path: messy, ranges: '*' },
      ],
      profile: DEFAULT_PROFILE,
      source: 17,
    });

    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].path, broken);
    assert.equal(fs.readFileSync(broken, 'utf8'), before);
    assert.deepEqual(result.formatted, [messy]);
  },
);

test(
  'real engine: leaves files with ranges "-" untouched',
  { skip: SKIP_WITHOUT_JDK },
  async (t) => {
    const manifest = await installedEngine();
    const dir = scratch(t);
    const file = copyFixture(dir, 'Messy.java');
    const before = fs.readFileSync(file, 'utf8');

    const result = runEngine({
      manifest,
      files: [{ path: file, ranges: null }],
      profile: DEFAULT_PROFILE,
      source: 17,
    });

    assert.deepEqual(result.formatted, []);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  },
);
