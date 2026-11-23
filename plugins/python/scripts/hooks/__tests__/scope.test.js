'use strict';

/*
Changed-lines scoping, end to end through the real ruff and pyright (see
check-and-loop.test.js for why they aren't mocked). Inside a git repo only
findings on or near lines that differ from the session base block the
stop; auto-fix, formatting and auto-suppression never touch the lines
around pre-existing findings. Outside a repo (every other suite here) and
with `whole_files` on, whole files are checked as before.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  mkScratchRepo,
  rmScratchDir,
  uniqueSessionId,
  runHook,
  track,
  SKIP_WITHOUT_RUFF,
} = require('./helpers');

const SLOW = { skip: SKIP_WITHOUT_RUFF, timeout: 180_000 };

/*
A module with three pre-existing findings near the top — F541 (fixable),
F841 (not fixable) and a pyright type error — and a function at the
bottom the tests edit. It is already ruff-format clean.
*/
const PAD = [1, 2, 3, 4].map((i) => `def pad${i}() -> int:\n    return ${i}\n`);
const ORIGINAL = [
  'x = f"hello"\n',
  'def old() -> None:\n    unused_old = 1\n',
  'y: int = "old"\n',
  ...PAD,
  'def target() -> int:\n    return 1\n',
].join('\n\n');

function edited(replacement) {
  return ORIGINAL.replace('def target() -> int:\n    return 1\n', replacement);
}

function lineOf(text, needle) {
  return text.split('\n').findIndex((line) => line.includes(needle)) + 1;
}

function setup(t) {
  const repo = mkScratchRepo({ 'mod.py': ORIGINAL });
  t.after(() => rmScratchDir(repo));
  return {
    scratch: repo,
    file: path.join(repo, 'mod.py'),
    pluginData: path.join(repo, '.plugin-data'),
    sessionId: uniqueSessionId(),
  };
}

function stop({ scratch, pluginData, sessionId }, options = {}) {
  const env = { CLAUDE_PLUGIN_DATA: pluginData };
  if (options.wholeFiles !== undefined) {
    env.CLAUDE_PLUGIN_OPTION_WHOLE_FILES = String(options.wholeFiles);
  }
  if (options.autoSuppress !== undefined) {
    env.CLAUDE_PLUGIN_OPTION_AUTO_SUPPRESS = String(options.autoSuppress);
  }
  return runHook(
    'check-and-loop.js',
    { hook_event_name: 'Stop', session_id: sessionId, cwd: scratch },
    { env },
  );
}

test('in a git repo, only a ruff finding on a changed line blocks', SLOW, (t) => {
  const ctx = setup(t);
  const text = edited('def target() -> int:\n    unused_new = 1\n    return 1\n');
  fs.writeFileSync(ctx.file, text);
  track(ctx.file, ctx);

  const res = stop(ctx);

  assert.equal(res.json?.decision, 'block', `expected a block, got: ${res.stdout}`);
  assert.match(res.json.reason, new RegExp(`mod\\.py:${lineOf(text, 'unused_new')}:\\d+: F841`));
  assert.doesNotMatch(res.json.reason, /unused_old|F541|"old"/);
  assert.match(res.stderr, /pre-existing/);
});

test('in a git repo, only a pyright error on a changed line blocks', SLOW, (t) => {
  const ctx = setup(t);
  const text = edited('def target() -> int:\n    return "new"\n');
  fs.writeFileSync(ctx.file, text);
  track(ctx.file, ctx);

  const res = stop(ctx);

  assert.equal(res.json?.decision, 'block', `expected a block, got: ${res.stdout}`);
  assert.match(res.json.reason, /## pyright/);
  assert.match(res.json.reason, new RegExp(`mod\\.py:${lineOf(text, 'return "new"')}:`));
  assert.doesNotMatch(res.json.reason, new RegExp(`mod\\.py:${lineOf(text, 'y: int')}:`));
});

test('in a git repo, pre-existing findings alone neither block nor get fixed', SLOW, (t) => {
  const ctx = setup(t);
  const text = edited('def target() -> int:\n    return 2\n');
  fs.writeFileSync(ctx.file, text);
  track(ctx.file, ctx);

  const res = stop(ctx);

  assert.equal(res.stdout.trim(), '', `expected no block, got: ${res.stdout}`);
  assert.match(res.stderr, /pre-existing/);
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), text, 'the file must not be rewritten');
});

test('in a git repo, formatting reaches only the changed lines', SLOW, (t) => {
  const ctx = setup(t);
  const messy = ORIGINAL.replace('x = f"hello"', 'x=f"hello"');
  const repo = mkScratchRepo({ 'mod.py': messy });
  t.after(() => rmScratchDir(repo));
  const own = { ...ctx, scratch: repo, file: path.join(repo, 'mod.py') };
  own.pluginData = path.join(repo, '.plugin-data');
  fs.writeFileSync(
    own.file,
    messy.replace('def target() -> int:\n    return 1\n', 'def target() -> int:\n    return   2\n'),
  );
  track(own.file, own);

  stop(own);

  const after = fs.readFileSync(own.file, 'utf8');
  assert.match(after, /^x=f"hello"$/m, 'an unchanged messy line must stay as it was');
  assert.match(after, /^ {4}return 2$/m, 'the changed line is formatted');
});

test('a pre-existing pyright error does not stop ruff fixing a changed line', SLOW, (t) => {
  const ctx = setup(t);
  // Only pyright's old error remains outside the edit; ruff's old ones are gone.
  const base = ORIGINAL.replace('x = f"hello"', 'x = "hello"').replace(
    '    unused_old = 1\n',
    '    pass\n',
  );
  const repo = mkScratchRepo({ 'mod.py': base });
  t.after(() => rmScratchDir(repo));
  const own = { ...ctx, scratch: repo, file: path.join(repo, 'mod.py') };
  own.pluginData = path.join(repo, '.plugin-data');
  // F541 (fixable) on the changed line.
  fs.writeFileSync(
    own.file,
    base.replace(
      'def target() -> int:\n    return 1\n',
      'def target() -> int:\n    return len(f"new")\n',
    ),
  );
  track(own.file, own);

  stop(own);

  const after = fs.readFileSync(own.file, 'utf8');
  assert.match(after, /def target\(\) -> int:\n {4}return len\("new"\)\n/);
  assert.match(after, /^y: int = "old"$/m, 'the old pyright error is left alone');
});

test('whole_files on: pre-existing findings block again', SLOW, (t) => {
  const ctx = setup(t);
  fs.writeFileSync(ctx.file, edited('def target() -> int:\n    return 2\n'));
  track(ctx.file, ctx);

  const res = stop(ctx, { wholeFiles: true });

  assert.equal(res.json?.decision, 'block', `expected a block, got: ${res.stdout}`);
  assert.match(res.json.reason, /F841/);
});

test('auto_suppress at the cap comments only the changed lines', SLOW, (t) => {
  const ctx = setup(t);
  fs.writeFileSync(
    ctx.file,
    edited('def target() -> int:\n    unused_new = 1\n    bad: int = "new"\n    return bad\n'),
  );
  track(ctx.file, ctx);

  for (let i = 0; i < 4; i += 1) stop(ctx, { autoSuppress: true });

  const after = fs.readFileSync(ctx.file, 'utf8');
  assert.match(after, /^ {4}unused_new = 1 {2}# noqa: F841$/m);
  assert.match(after, /^ {4}bad: int = "new" {2}# pyright: ignore\[reportAssignmentType\]$/m);
  assert.match(after, /^ {4}unused_old = 1$/m, 'old findings are not suppressed');
  assert.match(after, /^y: int = "old"$/m);
  assert.match(after, /^x = f"hello"$/m);
});
