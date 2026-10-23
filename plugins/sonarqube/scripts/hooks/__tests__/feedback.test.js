'use strict';

/*
 * The per-edit PostToolUse hook and the SessionStart warm-up, against the
 * stand-in `sonarlint` CLI from helpers.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  setup,
  writeFile,
  runHook,
  installFakeSonarlint,
  readInvocations,
  issue,
  gitRepo,
} = require('./helpers');

function edit(file, { sessionId, scratch, pluginData }, env, toolName = 'Edit') {
  return runHook(
    'feedback.js',
    {
      hook_event_name: 'PostToolUse',
      tool_name: toolName,
      tool_input: { file_path: file },
      session_id: sessionId,
      cwd: scratch,
    },
    { env: { CLAUDE_PLUGIN_DATA: pluginData, ...env } },
  );
}

test('reports MEDIUM+ issues and secrets as additionalContext, never blocking', (t) => {
  const ctx = setup(t);
  const file = writeFile(ctx.scratch, 'src/app.js');
  const fake = installFakeSonarlint(ctx.scratch, {
    files: {
      issues: [
        issue('src/app.js', 'secrets:S6290', 'BLOCKER', 3),
        issue('src/app.js', 'javascript:S1854', 'MEDIUM', 7, { hasQuickFix: true }),
        issue('src/app.js', 'javascript:S1481', 'LOW', 7),
      ],
    },
  });

  const res = edit(file, ctx, fake.env);

  assert.equal(res.status, 0);
  const out = res.json.hookSpecificOutput;
  assert.equal(out.hookEventName, 'PostToolUse');
  assert.equal(out.decision, undefined, 'feedback never blocks');
  assert.match(out.additionalContext, /2 issue\(s\) in src\/app\.js/);
  assert.match(out.additionalContext, /line 3 BLOCKER secrets:S6290/);
  assert.match(out.additionalContext, /line 7 MEDIUM javascript:S1854: .*\(quick fix available\)/);
  assert.doesNotMatch(out.additionalContext, /S1481/);
});

test('only talks to a running daemon (--no-start), on just the edited file', (t) => {
  const ctx = setup(t);
  const file = writeFile(ctx.scratch, 'src/app.js');
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [] } });

  edit(file, ctx, fake.env, 'Write');

  const [call] = readInvocations(fake.logFile);
  assert.deepEqual(call.argv.slice(0, 2), ['files', file]);
  assert.ok(call.argv.includes('--no-start'));
});

test('silent when clean, when the daemon is not running, or when the option is off', (t) => {
  const ctx = setup(t);
  const file = writeFile(ctx.scratch, 'src/app.js');

  const clean = installFakeSonarlint(ctx.scratch, { files: { issues: [] } });
  assert.equal(edit(file, ctx, clean.env).stdout, '');

  const cold = installFakeSonarlint(ctx.scratch, {
    files: { status: 2, stderr: 'no daemon is running\n' },
  });
  const coldRes = edit(file, ctx, cold.env);
  assert.equal(coldRes.stdout, '');
  assert.equal(coldRes.stderr, '');

  const off = installFakeSonarlint(ctx.scratch, {
    files: { issues: [issue('src/app.js', 'secrets:S6290', 'BLOCKER')] },
  });
  assert.equal(
    edit(file, ctx, { ...off.env, CLAUDE_PLUGIN_OPTION_PER_EDIT_FEEDBACK: 'false' }).stdout,
    '',
  );
});

test('ignores other tools, missing files and git-ignored files', (t) => {
  const ctx = setup(t);
  gitRepo(ctx.scratch);
  fs.writeFileSync(`${ctx.scratch}/.gitignore`, 'dist/\n');
  const ignored = writeFile(ctx.scratch, 'dist/bundle.js');
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [] } });

  edit(writeFile(ctx.scratch, 'a.js'), ctx, fake.env, 'Read');
  edit(`${ctx.scratch}/missing.js`, ctx, fake.env);
  edit(ignored, ctx, fake.env);

  assert.deepEqual(readInvocations(fake.logFile), []);
});

test('issues on lines this working tree did not change are left out', (t) => {
  const ctx = setup(t);
  const repo = gitRepo(ctx.scratch);
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  const file = writeFile(ctx.scratch, 'src/app.js', `${lines.join('\n')}\n`);
  repo.commitAll();
  lines[19] = 'changed';
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const fake = installFakeSonarlint(ctx.scratch, {
    files: {
      issues: [
        issue('src/app.js', 'javascript:S2259', 'HIGH', 3),
        issue('src/app.js', 'javascript:S3776', 'CRITICAL', 20),
      ],
    },
  });

  const context = edit(file, ctx, fake.env).json.hookSpecificOutput.additionalContext;

  assert.match(context, /S3776/);
  assert.doesNotMatch(context, /S2259/);
});

test('SessionStart warm-up starts the daemon for the session cwd', (t) => {
  const ctx = setup(t);
  const fake = installFakeSonarlint(ctx.scratch, { daemon: { status: 0 } });

  const res = runHook(
    'warm-daemon.js',
    { hook_event_name: 'SessionStart', session_id: ctx.sessionId, cwd: ctx.scratch },
    { env: { CLAUDE_PLUGIN_DATA: ctx.pluginData, ...fake.env } },
  );

  assert.equal(res.status, 0);
  const [call] = readInvocations(fake.logFile);
  assert.deepEqual(call.argv, ['daemon', 'start']);
  assert.equal(call.cwd, fs.realpathSync(ctx.scratch));
});

test('SessionStart is a silent no-op when SLOOP is not installed', (t) => {
  const ctx = setup(t);
  const res = runHook(
    'warm-daemon.js',
    { hook_event_name: 'SessionStart', session_id: ctx.sessionId, cwd: ctx.scratch },
    { env: { CLAUDE_PLUGIN_DATA: ctx.pluginData, SONARLINT_HOME: '', SONARLINT_CLI: '' } },
  );
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, '');
});
