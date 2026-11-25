'use strict';

/*
scripts/check-changes.js: the hook's formatting as a standalone
changed-lines check, through the real `npx prettier`. Each case is compared
with what the PostToolUse hook does to the same fixture.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratchRepo, rmScratchDir, uniqueSessionId, runHook } = require('./helpers');

const CLI = path.join(__dirname, '..', '..', 'check-changes.js');

// Eight badly formatted statements, then ten formatted ones, committed as-is.
const MESSY = 'abcdefgh'
  .split('')
  .map((name, i) => `const ${name}   =  ${i + 1}\n`)
  .join('');
const TIDY = Array.from({ length: 10 }, (_, i) => `const t${i} = ${i};\n`).join('');
const ORIGINAL = MESSY + TIDY;

function cli(args, env = {}) {
  const result = spawnSync('node', [CLI, ...args], {
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

function setup(t) {
  const repo = mkScratchRepo({ 'x.js': ORIGINAL });
  t.after(() => rmScratchDir(repo));
  return { repo, file: path.join(repo, 'x.js') };
}

// What the hook writes for the same edit, starting from the same text.
function hookResult({ repo, file }, text) {
  fs.writeFileSync(file, text);
  runHook('format.js', {
    tool_name: 'Write',
    tool_input: { file_path: file },
    session_id: uniqueSessionId(),
    cwd: repo,
  });
  return fs.readFileSync(file, 'utf8');
}

test('pre-existing unformatted lines out of scope do not block, and --fix leaves them', (t) => {
  const ctx = setup(t);
  const text = ORIGINAL.replace('const t8 = 8;', 'const t8 = 88;');
  fs.writeFileSync(ctx.file, text);

  const res = cli(['--fix', '--format', 'json', '--', ctx.file]);

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json.findings, []);
  assert.deepEqual(res.json.outOfScope, [{ file: ctx.file, count: 8 }]);
  assert.deepEqual(res.json.fixed, []);
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), text);
  assert.equal(hookResult(ctx, text), text);
});

test('an unformatted changed line blocks, and --fix formats just it, like the hook', (t) => {
  const ctx = setup(t);
  const text = ORIGINAL.replace('const t8 = 8;', 'const t8   =  88');

  fs.writeFileSync(ctx.file, text);
  const res = cli(['--format', 'json', '--', ctx.file]);
  assert.equal(res.status, 1, res.stderr);
  assert.deepEqual(
    res.json.findings.map((f) => [f.file, f.line, f.rule]),
    [[ctx.file, 17, 'prettier']],
  );
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), text, 'a check must not write');

  const fix = cli(['--fix', '--format', 'json', '--', ctx.file]);
  assert.equal(fix.status, 0, fix.stderr);
  assert.deepEqual(fix.json.fixed, [ctx.file]);
  const fixed = fs.readFileSync(ctx.file, 'utf8');
  assert.equal(fixed, ORIGINAL.replace('const t8 = 8;', 'const t8 = 88;'));
  assert.equal(hookResult(ctx, text), fixed);
});

test('text output lists what Prettier would rewrite', (t) => {
  const ctx = setup(t);
  fs.writeFileSync(ctx.file, ORIGINAL.replace('const t8 = 8;', 'const t8   =  88'));

  const res = cli(['--', ctx.file]);

  assert.equal(res.status, 1);
  assert.match(res.stdout, /x\.js:17: not formatted: Prettier would rewrite line 17/);
});

test('an untracked file is checked whole', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.repo, 'new.js');
  fs.writeFileSync(file, MESSY);

  const res = cli(['--format', 'json', '--', file]);

  assert.equal(res.status, 1);
  assert.equal(res.json.findings.length, 8);
  assert.deepEqual(res.json.outOfScope, []);
});

test('ignored paths and files Prettier has no parser for are passed over', (t) => {
  const ctx = setup(t);
  const vendored = path.join(ctx.repo, 'node_modules', 'v.js');
  fs.mkdirSync(path.dirname(vendored));
  fs.writeFileSync(vendored, MESSY);
  const unknown = path.join(ctx.repo, 'data.unknownext');
  fs.writeFileSync(unknown, 'x   =  1\n');

  const res = cli(['--format', 'json', '--', vendored, unknown]);

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json.checked, [unknown]);
  assert.deepEqual(res.json.findings, []);
});

/*
A prettier package in the scratch repo's own node_modules that always
crashes: npx prefers the nearest installed one, so it stands in for a
Prettier that cannot run.
*/
function installBrokenPrettier(repo) {
  const pkg = path.join(repo, 'node_modules', 'prettier');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(
    path.join(pkg, 'package.json'),
    JSON.stringify({ name: 'prettier', version: '0.0.0', bin: { prettier: 'bin.js' } }),
  );
  fs.writeFileSync(
    path.join(pkg, 'bin.js'),
    "#!/usr/bin/env node\nconsole.error('prettier crashed');\nprocess.exit(2);\n",
    { mode: 0o755 },
  );
  fs.mkdirSync(path.join(repo, 'node_modules', '.bin'));
  fs.symlinkSync(
    path.join('..', 'prettier', 'bin.js'),
    path.join(repo, 'node_modules', '.bin', 'prettier'),
  );
}

test(
  'a Prettier that cannot run is exit 2, never clean',
  { skip: process.platform === 'win32' },
  (t) => {
    const ctx = setup(t);
    fs.writeFileSync(ctx.file, ORIGINAL.replace('const t8 = 8;', 'const t8   =  88'));
    installBrokenPrettier(ctx.repo);

    const res = spawnSync('node', [CLI, '--format', 'json', '--', ctx.file], {
      cwd: ctx.repo,
      encoding: 'utf8',
    });

    assert.equal(res.status, 2, res.stdout);
    assert.match(
      JSON.parse(res.stdout).warnings.join('\n'),
      /could not format .*prettier crashed/s,
    );
  },
);

test('a file Prettier cannot parse is exit 2', (t) => {
  const ctx = setup(t);
  fs.writeFileSync(ctx.file, `${ORIGINAL}const = ;\n`);

  assert.equal(cli(['--', ctx.file]).status, 2);
});
