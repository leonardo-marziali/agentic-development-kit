'use strict';

/*
scripts/check-changes.js: the Stop hook's ruff and pyright check as a
standalone command, through the real tools. Each verdict is compared with
what the hook decides on the same fixture, so the two can't drift.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  mkScratchRepo,
  rmScratchDir,
  uniqueSessionId,
  runHook,
  track,
  SKIP_WITHOUT_RUFF,
} = require('./helpers');

const SLOW = { skip: SKIP_WITHOUT_RUFF, timeout: 180_000 };
const CLI = path.join(__dirname, '..', '..', 'check-changes.js');

// Clean, formatted padding and a function at the bottom the tests edit.
const PAD = [1, 2, 3, 4].map((i) => `def pad${i}() -> int:\n    return ${i}\n`);
const TARGET = 'def target() -> int:\n    return 1\n';
const CLEAN = [...PAD, TARGET].join('\n\n');
// Three pre-existing findings at the top: F541, F841 and a pyright error.
const LEGACY = ['x = f"hello"\n', 'def old() -> None:\n    unused_old = 1\n', 'y: int = "old"\n'];
const ORIGINAL = [...LEGACY, CLEAN].join('\n\n');

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

function setup(t, contents = ORIGINAL) {
  const repo = mkScratchRepo({ 'mod.py': contents });
  t.after(() => rmScratchDir(repo));
  return {
    scratch: repo,
    file: path.join(repo, 'mod.py'),
    pluginData: path.join(repo, '.plugin-data'),
    sessionId: uniqueSessionId(),
  };
}

// The hook's verdict on the same file: 'block' or 'pass'.
function hookVerdict(ctx, file = ctx.file) {
  track(file, ctx);
  const res = runHook(
    'check-and-loop.js',
    { hook_event_name: 'Stop', session_id: ctx.sessionId, cwd: ctx.scratch },
    { env: { CLAUDE_PLUGIN_DATA: ctx.pluginData } },
  );
  return res.json?.decision === 'block' ? 'block' : 'pass';
}

test('pre-existing findings out of scope do not block, and --fix leaves the file', SLOW, (t) => {
  const ctx = setup(t);
  const text = ORIGINAL.replace(TARGET, 'def target() -> int:\n    return 2\n');
  fs.writeFileSync(ctx.file, text);

  const res = cli(['--fix', '--format', 'json', '--', ctx.file]);

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json.findings, []);
  assert.deepEqual(res.json.outOfScope, [{ file: ctx.file, count: 3 }]);
  assert.deepEqual(res.json.fixed, []);
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), text);
  assert.equal(hookVerdict(ctx), 'pass');
});

test('a new finding in scope blocks, as in the hook', SLOW, (t) => {
  const ctx = setup(t);
  const text = ORIGINAL.replace(TARGET, 'def target() -> int:\n    unused_new = 1\n    return 1\n');
  fs.writeFileSync(ctx.file, text);
  const line = text.split('\n').findIndex((l) => l.includes('unused_new')) + 1;

  const res = cli(['--format', 'json', '--', ctx.file]);

  assert.equal(res.status, 1, res.stderr);
  assert.deepEqual(
    res.json.findings.map((f) => [f.file, f.line, f.rule]),
    [[ctx.file, line, 'F841']],
  );
  assert.match(cli(['--', ctx.file]).stdout, /## ruff\n\n.*mod\.py:\d+:\d+: F841 /);
  assert.equal(hookVerdict(ctx), 'block');
});

test('without --fix nothing is written; with --fix ruff fixes and formats it', SLOW, (t) => {
  const ctx = setup(t, CLEAN);
  const dirty = CLEAN.replace(TARGET, 'import os\ndef target() -> int:\n    return 1\n');
  fs.writeFileSync(ctx.file, dirty);

  const res = cli(['--format', 'json', '--', ctx.file]);
  assert.equal(res.status, 1, res.stderr);
  assert.ok(
    res.json.findings.some((f) => f.rule === 'F401'),
    res.stdout,
  );
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), dirty, 'a check must not write');

  const fix = cli(['--fix', '--format', 'json', '--', ctx.file]);
  assert.equal(fix.status, 0, fix.stderr);
  assert.deepEqual(fix.json.fixed, [ctx.file]);
  const fixed = fs.readFileSync(ctx.file, 'utf8');
  assert.doesNotMatch(fixed, /import os/);

  fs.writeFileSync(ctx.file, dirty);
  assert.equal(hookVerdict(ctx), 'pass');
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), fixed, 'the hook fixes it the same way');
});

test('an untracked file is checked whole', SLOW, (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.scratch, 'new.py');
  fs.writeFileSync(file, 'def old() -> None:\n    unused_old = 1\n');

  const res = cli(['--format', 'json', '--', file]);

  assert.equal(res.status, 1);
  assert.deepEqual(
    res.json.findings.map((f) => f.rule),
    ['F841'],
  );
  assert.equal(hookVerdict(ctx, file), 'block');
});

test('paths that are not Python source are ignored', (t) => {
  const ctx = setup(t);
  const venv = path.join(ctx.scratch, '.venv', 'lib', 'm.py');
  fs.mkdirSync(path.dirname(venv), { recursive: true });
  fs.writeFileSync(venv, 'x = f"hello"\n');

  const res = cli(['--format', 'json', '--', venv, path.join(ctx.scratch, 'README.md')]);

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json.checked, []);
});

test('a missing ruff is exit 2, never clean', SLOW, (t) => {
  const ctx = setup(t);
  fs.writeFileSync(ctx.file, ORIGINAL.replace(TARGET, 'def target() -> int:\n    return 2\n'));

  // PATH minus ruff and uvx, with node kept reachable (see check-and-loop.test.js).
  const hasRuff = (dir) => ['ruff', 'uvx'].some((bin) => fs.existsSync(path.join(dir, bin)));
  const nodeOnly = path.join(ctx.scratch, 'node-only-bin');
  fs.mkdirSync(nodeOnly);
  fs.symlinkSync(process.execPath, path.join(nodeOnly, path.basename(process.execPath)));
  const PATH = [
    nodeOnly,
    ...(process.env.PATH || '').split(path.delimiter).filter((dir) => !hasRuff(dir)),
  ].join(path.delimiter);

  const res = cli(['--format', 'json', '--', ctx.file], { PATH });

  assert.equal(res.status, 2, res.stdout);
  assert.ok(res.json.warnings.some((w) => /ruff not found/.test(w)));
});
