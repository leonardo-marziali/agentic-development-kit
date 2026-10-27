'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchDir, rmScratchDir, uniqueSessionId, track, runHook } = require('./helpers');

function setup(t) {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  return { scratch, pluginData: path.join(scratch, 'plugin-data'), sessionId: uniqueSessionId() };
}

function touched({ pluginData, sessionId }) {
  const listFile = path.join(pluginData, 'python-session-scope', sessionId, 'touched-files.txt');
  return fs.existsSync(listFile)
    ? fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean)
    : [];
}

// Creates `relPath` under the scratch dir and returns its absolute path.
function create({ scratch }, relPath) {
  const file = path.join(scratch, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x = 1\n');
  return file;
}

for (const { name, file, tool } of [
  { name: 'a .py file on Write', file: 'mod.py', tool: 'Write' },
  { name: 'a .pyi stub on Edit', file: 'mod.pyi', tool: 'Edit' },
]) {
  test(`tracks ${name}`, (t) => {
    const ctx = setup(t);
    const abs = create(ctx, file);

    const res = track(abs, ctx, tool);

    assert.equal(res.status, 0);
    assert.deepEqual(touched(ctx), [abs]);
  });
}

test('resolves a relative file_path against the session cwd', (t) => {
  const ctx = setup(t);
  const abs = create(ctx, 'mod.py');

  track('mod.py', ctx);

  assert.deepEqual(touched(ctx), [abs]);
});

test('dedups repeated writes to the same file', (t) => {
  const ctx = setup(t);
  const abs = create(ctx, 'mod.py');

  track(abs, ctx);
  track(abs, ctx);

  assert.deepEqual(touched(ctx), [abs]);
});

/*
Each case is a tool call the hook must not record: [description, file to
create (null: leave it missing), path passed to the hook, tool name].
*/
for (const [name, created, passed, tool] of [
  ['non-Python files', 'notes.txt', 'notes.txt', 'Write'],
  ['Python files inside a virtualenv', '.venv/lib/site-packages/pkg/mod.py', null, 'Write'],
  ['tool names other than Edit/Write', 'mod.py', 'mod.py', 'Read'],
  ["a file_path that doesn't exist on disk", null, 'missing.py', 'Write'],
]) {
  test(`ignores ${name}`, (t) => {
    const ctx = setup(t);
    const abs = created ? create(ctx, created) : null;

    const res = track(passed ? path.join(ctx.scratch, passed) : abs, ctx, tool);

    assert.equal(res.status, 0);
    assert.deepEqual(touched(ctx), []);
  });
}

function bash(event, { scratch, pluginData, sessionId }, extra = {}) {
  return runHook(
    'track-touched.js',
    {
      hook_event_name: event,
      tool_name: 'Bash',
      tool_input: { command: 'python gen.py' },
      tool_use_id: 'toolu_bash',
      session_id: sessionId,
      cwd: scratch,
      ...extra,
    },
    { env: { CLAUDE_PLUGIN_DATA: pluginData } },
  );
}

test('tracks .py files a Bash command wrote, and nothing else it wrote', (t) => {
  const ctx = setup(t);

  bash('PreToolUse', ctx);
  const abs = create(ctx, 'pkg/generated.py');
  create(ctx, 'notes.txt');
  create(ctx, '.venv/lib/site.py');
  bash('PostToolUse', ctx);

  assert.deepEqual(touched(ctx), [abs]);
});

test('tracks a Bash command that failed after writing, via PostToolUseFailure', (t) => {
  const ctx = setup(t);

  bash('PreToolUse', ctx);
  const abs = create(ctx, 'mod.py');
  bash('PostToolUseFailure', ctx, { error: 'Exit code 1' });

  assert.deepEqual(touched(ctx), [abs]);
});

test("tracks a subagent's writes in its own list too", (t) => {
  const ctx = setup(t);
  const abs = create(ctx, 'mod.py');

  runHook(
    'track-touched.js',
    {
      tool_name: 'Write',
      tool_input: { file_path: abs },
      session_id: ctx.sessionId,
      cwd: ctx.scratch,
      agent_id: 'sub1',
    },
    { env: { CLAUDE_PLUGIN_DATA: ctx.pluginData } },
  );

  const agentList = path.join(
    ctx.pluginData,
    'python-session-scope',
    ctx.sessionId,
    'agents',
    'sub1',
    'touched-files.txt',
  );
  assert.deepEqual(touched(ctx), [abs]);
  assert.deepEqual(fs.readFileSync(agentList, 'utf8').split('\n').filter(Boolean), [abs]);
});
