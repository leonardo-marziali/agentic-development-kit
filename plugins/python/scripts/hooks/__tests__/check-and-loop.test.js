'use strict';

/*
Integration suite: these hit the real ruff and pyright, same as the hook
does at runtime (same convention as the markdown plugin's suite — a mock
wouldn't catch a change in either tool's flags, exit codes or output).
pyright resolves from PATH or falls back to `npx -y pyright`, so a cold
machine needs network access the first time; each test spawns real
subprocesses, so this file is slower than lib.test.js.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  mkScratchDir,
  rmScratchDir,
  uniqueSessionId,
  runHook,
  track,
  SKIP_WITHOUT_RUFF,
} = require('./helpers');

const CLEAN_PY = 'def add(a: int, b: int) -> int:\n    return a + b\n';
// F541: f-string without placeholders — ruff fixes it on its own.
const FIXABLE_PY = 'x = f"hello"\n';
// F841: unused local — ruff's only fix is unsafe, so --fix leaves it.
const RUFF_UNFIXABLE_PY = 'def f() -> None:\n    unused = 1\n';
// reportAssignmentType — a pyright error ruff doesn't see.
const TYPE_ERROR_PY = 'x: int = "not an int"\n';

const SLOW = { skip: SKIP_WITHOUT_RUFF, timeout: 120_000 };

function setup(t) {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  return { scratch, pluginData: path.join(scratch, 'plugin-data'), sessionId: uniqueSessionId() };
}

function writePy(scratch, name, content) {
  const file = path.join(scratch, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function stop(
  { scratch, pluginData, sessionId },
  { hookEventName = 'Stop', autoSuppress, env } = {},
) {
  const hookEnv = { CLAUDE_PLUGIN_DATA: pluginData, ...env };
  if (autoSuppress !== undefined) {
    hookEnv.CLAUDE_PLUGIN_OPTION_AUTO_SUPPRESS = String(autoSuppress);
  }
  return runHook(
    'check-and-loop.js',
    { hook_event_name: hookEventName, session_id: sessionId, cwd: scratch },
    { env: hookEnv },
  );
}

function stateDirFor({ pluginData, sessionId }) {
  return path.join(pluginData, 'python-session-scope', sessionId);
}

test('no tracked files: no-op, empty stdout', (t) => {
  const ctx = setup(t);

  const res = stop(ctx);

  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

test('clean file: allows the stop and clears session state', SLOW, (t) => {
  const ctx = setup(t);
  track(writePy(ctx.scratch, 'mod.py', CLEAN_PY), ctx);

  const res = stop(ctx);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout.trim(), '');
  assert.equal(fs.existsSync(stateDirFor(ctx)), false);
});

test('auto-fixable ruff finding: fixed in place, stop allowed', SLOW, (t) => {
  const ctx = setup(t);
  const file = writePy(ctx.scratch, 'mod.py', FIXABLE_PY);
  track(file, ctx);

  const res = stop(ctx);

  assert.equal(res.stdout.trim(), '', res.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), 'x = "hello"\n');
});

test('unfixable ruff finding: blocks with the ruff report', SLOW, (t) => {
  const ctx = setup(t);
  const file = writePy(ctx.scratch, 'mod.py', RUFF_UNFIXABLE_PY);
  track(file, ctx);

  const res = stop(ctx);

  const out = res.json;
  assert.equal(out?.decision, 'block', res.stderr);
  assert.equal('hookSpecificOutput' in out, false);
  assert.match(out.reason, /## ruff/);
  assert.match(out.reason, /F841/);
  assert.match(out.reason, /attempt 1\/3/);
  assert.doesNotMatch(out.reason, /## pyright/);
});

test('pyright error: blocks with the pyright report', SLOW, (t) => {
  const ctx = setup(t);
  track(writePy(ctx.scratch, 'mod.py', TYPE_ERROR_PY), ctx);

  const res = stop(ctx, { hookEventName: 'SubagentStop' });

  const out = res.json;
  assert.equal(out?.decision, 'block', res.stderr);
  assert.equal('hookSpecificOutput' in out, false);
  assert.match(out.reason, /## pyright/);
  assert.match(out.reason, /mod\.py:1:\d+ - error: [\s\S]*\(reportAssignmentType\)/);
  assert.doesNotMatch(out.reason, /## ruff/);
});

test("pyright respects the nearest project's config", SLOW, (t) => {
  const ctx = setup(t);
  writePy(ctx.scratch, 'pkg/pyproject.toml', '[tool.pyright]\nreportAssignmentType = false\n');
  track(writePy(ctx.scratch, 'pkg/src/mod.py', TYPE_ERROR_PY), ctx);

  const res = stop(ctx);

  assert.equal(res.stdout.trim(), '', res.stderr);
});

test('pyright warnings never block', SLOW, (t) => {
  const ctx = setup(t);
  writePy(ctx.scratch, 'pyrightconfig.json', '{ "reportAssignmentType": "warning" }\n');
  track(writePy(ctx.scratch, 'mod.py', TYPE_ERROR_PY), ctx);

  const res = stop(ctx);

  assert.equal(res.stdout.trim(), '', res.stderr);
});

test('a file fixed between stops is allowed through on the next one', SLOW, (t) => {
  const ctx = setup(t);
  const file = writePy(ctx.scratch, 'mod.py', RUFF_UNFIXABLE_PY);
  track(file, ctx);

  assert.equal(stop(ctx).json?.decision, 'block');

  fs.writeFileSync(file, 'def f() -> None:\n    pass\n');
  const res = stop(ctx);

  assert.equal(res.stdout.trim(), '', res.stderr);
  assert.equal(fs.existsSync(stateDirFor(ctx)), false);
});

test('cap with auto_suppress off: stops blocking, reports, leaves files alone', SLOW, (t) => {
  const ctx = setup(t);
  // Already formatted, so the loop's ruff format pass changes nothing.
  const content = `${RUFF_UNFIXABLE_PY}\n\n${TYPE_ERROR_PY}`;
  const file = writePy(ctx.scratch, 'mod.py', content);
  track(file, ctx);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = stop(ctx);
    assert.match(res.json?.reason ?? '', new RegExp(`attempt ${attempt}/3`));
  }
  const res = stop(ctx, { autoSuppress: false });

  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /findings remain after 3 fix attempts/);
  assert.match(res.stderr, /F841/);
  assert.equal(fs.readFileSync(file, 'utf8'), content);
  assert.equal(fs.existsSync(stateDirFor(ctx)), false);
});

test('cap with auto_suppress on: writes noqa and pyright ignores that silence both', SLOW, (t) => {
  const ctx = setup(t);
  const file = writePy(ctx.scratch, 'mod.py', `${RUFF_UNFIXABLE_PY}\n\n${TYPE_ERROR_PY}`);
  track(file, ctx);

  for (let attempt = 1; attempt <= 3; attempt++) stop(ctx, { autoSuppress: true });
  const res = stop(ctx, { autoSuppress: true });

  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /auto-suppressed/);
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    'def f() -> None:\n' +
      '    unused = 1  # noqa: F841\n\n\n' +
      'x: int = "not an int"  # pyright: ignore[reportAssignmentType]\n',
  );

  // The suppressed file now passes a fresh session's check outright.
  const next = { ...ctx, sessionId: uniqueSessionId() };
  track(file, next);
  assert.equal(stop(next).stdout.trim(), '');
});

test('missing ruff fails open: pyright still runs, ruff is skipped with a note', SLOW, (t) => {
  const ctx = setup(t);
  track(writePy(ctx.scratch, 'mod.py', RUFF_UNFIXABLE_PY + TYPE_ERROR_PY), ctx);

  /*
  PATH minus every directory holding ruff or uvx; pyright still resolves,
  from PATH or through npx beside node.
  */
  const hasRuff = (dir) => ['ruff', 'uvx'].some((bin) => fs.existsSync(path.join(dir, bin)));
  const pathWithoutRuff = (process.env.PATH || '')
    .split(path.delimiter)
    .filter((dir) => !hasRuff(dir))
    .join(path.delimiter);
  const res = stop(ctx, { env: { PATH: pathWithoutRuff } });

  const out = res.json;
  assert.match(res.stderr, /ruff not found/);
  assert.match(out?.reason ?? '', /## pyright/, res.stderr);
  assert.doesNotMatch(out.reason, /## ruff/);
});

test("SubagentStop holds a subagent only to its own files; Stop checks everyone's", SLOW, (t) => {
  const ctx = setup(t);
  const mine = writePy(ctx.scratch, 'parent.py', RUFF_UNFIXABLE_PY);
  const theirs = writePy(ctx.scratch, 'child.py', RUFF_UNFIXABLE_PY);
  track(mine, ctx);
  runHook(
    'track-touched.js',
    {
      tool_name: 'Write',
      tool_input: { file_path: theirs },
      session_id: ctx.sessionId,
      cwd: ctx.scratch,
      agent_id: 'sub1',
    },
    { env: { CLAUDE_PLUGIN_DATA: ctx.pluginData } },
  );

  const sub = runHook(
    'check-and-loop.js',
    {
      hook_event_name: 'SubagentStop',
      agent_id: 'sub1',
      session_id: ctx.sessionId,
      cwd: ctx.scratch,
    },
    { env: { CLAUDE_PLUGIN_DATA: ctx.pluginData } },
  );
  assert.equal(sub.json?.decision, 'block', sub.stderr);
  assert.match(sub.json.reason, /child\.py/);
  assert.doesNotMatch(sub.json.reason, /parent\.py/);

  const main = stop(ctx);
  assert.equal(main.json?.decision, 'block', main.stderr);
  assert.match(main.json.reason, /child\.py/);
  assert.match(main.json.reason, /parent\.py/);
});
