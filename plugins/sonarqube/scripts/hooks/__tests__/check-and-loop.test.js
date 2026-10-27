'use strict';

/*
 * Integration suite for the Stop/SubagentStop hook. It runs the hook script
 * exactly as Claude Code does, against a stand-in `sonarlint` CLI (see
 * helpers.js) that logs how it was called and answers from a spec — so the
 * tests assert on the real contract (which files were analyzed, from which
 * cwd, what blocks and what doesn't) without needing a SLOOP install.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  setup,
  writeFile,
  runHook,
  installFakeSonarlint,
  writeSpec,
  readInvocations,
  issue,
  gitRepo,
} = require('./helpers');

function writeBinding(dir, binding) {
  fs.mkdirSync(path.join(dir, '.sonarlint'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.sonarlint', 'connectedMode.json'), JSON.stringify(binding));
}

function track(file, { sessionId, scratch, pluginData }) {
  return runHook(
    'track-touched.js',
    { tool_name: 'Write', tool_input: { file_path: file }, session_id: sessionId, cwd: scratch },
    { env: { CLAUDE_PLUGIN_DATA: pluginData } },
  );
}

function stop({ sessionId, scratch, pluginData, env = {}, hookEventName = 'Stop' }) {
  return runHook(
    'check-and-loop.js',
    { hook_event_name: hookEventName, session_id: sessionId, cwd: scratch },
    { env: { CLAUDE_PLUGIN_DATA: pluginData, ...env } },
  );
}

function stateDirFor(pluginData, sessionId) {
  return path.join(pluginData, 'sonarqube-session-scope', sessionId);
}

const SECRET = issue('src/app.js', 'secrets:S6290', 'BLOCKER', 3);
const HIGH = issue('src/app.js', 'javascript:S2259', 'HIGH', 5, { type: 'BUG' });
const MEDIUM = issue('src/app.js', 'javascript:S1854', 'MEDIUM', 7);

test('no tracked files: no-op, the CLI is never run', (t) => {
  const ctx = setup(t);
  const fake = installFakeSonarlint(ctx.scratch);

  const res = stop({ ...ctx, env: fake.env });

  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
  assert.deepEqual(readInvocations(fake.logFile), []);
});

test('the touched files are analyzed in one run, as json, from the session cwd', (t) => {
  const ctx = setup(t);
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [] } });
  const a = writeFile(ctx.scratch, 'src/app.js');
  const b = writeFile(ctx.scratch, 'src/job.py');
  track(a, ctx);
  track(b, ctx);

  stop({ ...ctx, env: fake.env });

  const [call] = readInvocations(fake.logFile);
  assert.equal(call.cwd, fs.realpathSync(ctx.scratch));
  assert.deepEqual(call.argv.slice(0, 3), ['files', a, b]);
  assert.ok(call.argv.includes('--format') && call.argv.includes('json'));
  assert.ok(call.argv.includes('--timeout'), 'the CLI is bounded below the hook timeout');
});

test('a secret blocks the stop with decision continue', (t) => {
  const ctx = setup(t);
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [SECRET] } });
  track(writeFile(ctx.scratch, 'src/app.js'), ctx);

  const res = stop({ ...ctx, env: fake.env });

  assert.equal(res.json.decision, 'block');
  assert.equal('hookSpecificOutput' in res.json, false);
  const message = res.json.reason;
  assert.match(message, /src\/app\.js:3 BLOCKER secrets:S6290/);
  assert.match(message, /rotat/);
  assert.match(message, /NOSONAR/);
});

test('HIGH blocks under the default policy; MEDIUM alone does not', (t) => {
  const ctx = setup(t);
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [HIGH, MEDIUM] } });
  track(writeFile(ctx.scratch, 'src/app.js'), ctx);

  const blocked = stop({ ...ctx, env: fake.env });
  assert.equal(blocked.json.decision, 'block');
  assert.match(blocked.json.reason, /javascript:S2259/);
  assert.doesNotMatch(blocked.json.reason, /javascript:S1854/);

  const ctx2 = setup(t);
  const fake2 = installFakeSonarlint(ctx2.scratch, { files: { issues: [MEDIUM] } });
  track(writeFile(ctx2.scratch, 'src/app.js'), ctx2);
  const clean = stop({ ...ctx2, env: fake2.env });
  assert.equal(clean.stdout.trim(), '');
});

test('min_blocking_severity=medium blocks on MEDIUM; secrets-only lets HIGH through but not a secret', (t) => {
  const ctx = setup(t);
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [MEDIUM] } });
  track(writeFile(ctx.scratch, 'src/app.js'), ctx);
  const res = stop({
    ...ctx,
    env: { ...fake.env, CLAUDE_PLUGIN_OPTION_MIN_BLOCKING_SEVERITY: 'medium' },
  });
  assert.equal(res.json.decision, 'block');

  const ctx2 = setup(t);
  const fake2 = installFakeSonarlint(ctx2.scratch, { files: { issues: [HIGH] } });
  track(writeFile(ctx2.scratch, 'src/app.js'), ctx2);
  const env2 = { ...fake2.env, CLAUDE_PLUGIN_OPTION_MIN_BLOCKING_SEVERITY: 'secrets-only' };
  assert.equal(stop({ ...ctx2, env: env2 }).stdout.trim(), '');

  const ctx3 = setup(t);
  const fake3 = installFakeSonarlint(ctx3.scratch, { files: { issues: [SECRET] } });
  track(writeFile(ctx3.scratch, 'src/app.js'), ctx3);
  const env3 = { ...fake3.env, CLAUDE_PLUGIN_OPTION_MIN_BLOCKING_SEVERITY: 'secrets-only' };
  assert.equal(stop({ ...ctx3, env: env3 }).json.decision, 'block');
});

test('everything clean: silent, and the session state is cleared', (t) => {
  const ctx = setup(t);
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [] } });
  track(writeFile(ctx.scratch, 'src/app.js'), ctx);

  const res = stop({ ...ctx, env: fake.env });

  assert.equal(res.stdout.trim(), '');
  assert.equal(fs.existsSync(stateDirFor(ctx.pluginData, ctx.sessionId)), false);
});

test('a tool failure (exit 2) is reported, never blocks, and keeps the state for the next stop', (t) => {
  const ctx = setup(t);
  const fake = installFakeSonarlint(ctx.scratch, {
    files: {
      status: 2,
      stderr: 'sonarlint: SLOOP is not installed (looked in /x). Run /sonarqube:setup\n',
    },
  });
  track(writeFile(ctx.scratch, 'src/app.js'), ctx);

  const res = stop({ ...ctx, env: fake.env });

  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /were NOT checked/);
  assert.match(res.stderr, /Run \/sonarqube:setup/);
  assert.ok(
    fs.existsSync(path.join(stateDirFor(ctx.pluginData, ctx.sessionId), 'touched-files.txt')),
  );
});

test('skipped files and analyzers that could not load are reported on stderr', (t) => {
  const ctx = setup(t);
  const fake = installFakeSonarlint(ctx.scratch, {
    files: {
      issues: [],
      skipped: [{ file: 'src/gone.js', reason: 'not found' }],
      skippedAnalyzers: [{ language: 'JS', reason: 'UNSATISFIED_NODE_JS' }],
    },
  });
  track(writeFile(ctx.scratch, 'src/app.js'), ctx);

  const res = stop({ ...ctx, env: fake.env });

  assert.match(res.stderr, /skipped src\/gone\.js: not found/);
  assert.match(res.stderr, /JS analyzer could not load \(UNSATISFIED_NODE_JS\)/);
});

test('attempt cap: blocks 3 times, then reports and lets the stop through', (t) => {
  const ctx = setup(t);
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [SECRET] } });
  const file = writeFile(ctx.scratch, 'src/app.js', 'const k = "x";\n');
  track(file, ctx);

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const res = stop({ ...ctx, env: fake.env });
    assert.equal(res.json.decision, 'block', `attempt ${attempt}`);
    assert.match(res.json.reason, new RegExp(`attempt ${attempt}/3`));
  }

  const final = stop({ ...ctx, env: fake.env });
  assert.equal(final.stdout.trim(), '');
  assert.match(final.stderr, /findings remain after 3 attempts/);
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    'const k = "x";\n',
    'nothing is ever written to the file',
  );
  assert.equal(fs.existsSync(stateDirFor(ctx.pluginData, ctx.sessionId)), false);
});

test('SubagentStop blocks with the same top-level payload', (t) => {
  const ctx = setup(t);
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [SECRET] } });
  track(writeFile(ctx.scratch, 'src/app.js'), ctx);

  const res = stop({ ...ctx, env: fake.env, hookEventName: 'SubagentStop' });

  assert.equal('hookSpecificOutput' in res.json, false);
});

test('pre-existing HIGH findings on unchanged lines are reported, not blocked on; secrets still block', (t) => {
  const ctx = setup(t);
  const repo = gitRepo(ctx.scratch);
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  const file = writeFile(ctx.scratch, 'src/app.js', `${lines.join('\n')}\n`);
  repo.commitAll();
  lines[19] = 'changed line 20';
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  track(file, ctx);

  const old = issue('src/app.js', 'javascript:S2259', 'HIGH', 3);
  const fresh = issue('src/app.js', 'javascript:S3776', 'CRITICAL', 20);
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [old] } });

  const res = stop({ ...ctx, env: fake.env });
  assert.equal(res.stdout.trim(), '', 'a finding only on an unchanged line does not block');
  assert.match(res.stderr, /pre-existing finding\(s\) at\/above HIGH/);
  assert.match(res.stderr, /src\/app\.js:3 HIGH javascript:S2259/);

  // A stop that didn't block cleared the session's state; the next edit re-tracks it.
  track(file, ctx);
  writeSpec(fake.specFile, {
    files: { issues: [old, fresh, issue('src/app.js', 'secrets:S6290', 'BLOCKER', 1)] },
  });
  const blocked = stop({ ...ctx, env: fake.env });
  const message = blocked.json.reason;
  assert.match(message, /javascript:S3776/);
  assert.match(message, /secrets:S6290/, 'a secret blocks even on an unchanged line');
  assert.doesNotMatch(message, /javascript:S2259/);
});

test('connected mode: findings are grouped under the binding that owns them', (t) => {
  const ctx = setup(t);
  writeBinding(path.join(ctx.scratch, 'api'), {
    projectKey: 'acme_api',
    sonarCloudOrganization: 'acme',
  });
  const a = writeFile(ctx.scratch, 'api/src/handler.ts');
  const b = writeFile(ctx.scratch, 'web/page.ts');
  track(a, ctx);
  track(b, ctx);
  const fake = installFakeSonarlint(ctx.scratch, {
    files: {
      issues: [
        issue('api/src/handler.ts', 'secrets:S6290', 'BLOCKER', 1),
        issue('web/page.ts', 'typescript:S2259', 'HIGH', 2),
      ],
    },
  });

  const message = stop({ ...ctx, env: fake.env }).json.reason;

  assert.match(message, /## acme_api \(SonarQube Cloud org acme\)[^#]*api\/src\/handler\.ts:1/);
  assert.match(
    message,
    new RegExp(
      `## ${fs.realpathSync(ctx.scratch).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^#]*web/page\\.ts:2`,
    ),
  );
});

test('a deleted file drops out of the set before analysis runs', (t) => {
  const ctx = setup(t);
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [] } });
  const kept = writeFile(ctx.scratch, 'src/kept.js');
  const gone = writeFile(ctx.scratch, 'src/gone.js');
  track(kept, ctx);
  track(gone, ctx);
  fs.rmSync(gone);

  stop({ ...ctx, env: fake.env });

  const [call] = readInvocations(fake.logFile);
  assert.ok(call.argv.includes(kept));
  assert.ok(!call.argv.includes(gone));
});
