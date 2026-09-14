'use strict';

/*
 * Integration suite for the Stop/SubagentStop hook. It runs the hook script
 * exactly as Claude Code does, against a stand-in `sonar` executable rather
 * than the real CLI — which is a prerequisite this repository deliberately
 * doesn't install, and which would otherwise make the suite unrunnable in CI.
 * The stand-in logs its argv and cwd, so the tests still assert on the real
 * contract: which subcommand ran, with which --project, from which directory.
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
  installFakeSonar,
  readInvocations,
  fakeSonarEnv,
  noSonarEnv,
  systemSonarInstalled,
} = require('./helpers');

const SECRET_REPORT = 'src/app.js:3 aws-access-key-id: hardcoded credential';
const ISSUE_REPORT = '{"issues":[{"rule":"javascript:S1481","message":"Remove this unused var"}]}';

function setup(t) {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  return { scratch, pluginData: path.join(scratch, 'plugin-data'), sessionId: uniqueSessionId() };
}

function writeFile(scratch, relative, contents = 'x\n') {
  const full = path.join(scratch, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

function writeBinding(dir, binding) {
  fs.mkdirSync(path.join(dir, '.sonarlint'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.sonarlint', 'connectedMode.json'), JSON.stringify(binding));
}

function track(file, { sessionId, scratch, pluginData, env = {} }) {
  return runHook(
    'track-touched.js',
    { tool_name: 'Write', tool_input: { file_path: file }, session_id: sessionId, cwd: scratch },
    { env: { CLAUDE_PLUGIN_DATA: pluginData, ...env } },
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

test('no tracked files: no-op, empty stdout', (t) => {
  const ctx = setup(t);
  const { binDir } = installFakeSonar(ctx.scratch);

  const res = stop({ ...ctx, env: fakeSonarEnv(ctx.scratch, binDir) });

  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

test('sonar not installed: no-op with one stderr note, never blocks', (t) => {
  if (systemSonarInstalled()) {
    t.skip('a real `sonar` is installed in a fixed system location');
    return;
  }
  const ctx = setup(t);
  const file = writeFile(ctx.scratch, 'src/app.js');
  const env = noSonarEnv(ctx.scratch);
  track(file, { ...ctx, env });

  const res = stop({ ...ctx, env });

  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /`sonar` CLI was not found/);
});

test('secrets found: blocks the stop with decision continue', (t) => {
  const ctx = setup(t);
  const { binDir } = installFakeSonar(ctx.scratch, {
    secrets: { status: 51, stdout: SECRET_REPORT },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  track(writeFile(ctx.scratch, 'src/app.js'), { ...ctx, env });

  const res = stop({ ...ctx, env });

  assert.ok(res.json, `expected JSON stdout, got: ${res.stdout}`);
  assert.equal(res.json.hookSpecificOutput.decision, 'continue');
  assert.equal(res.json.hookSpecificOutput.hookEventName, 'Stop');
  assert.match(res.json.hookSpecificOutput.systemMessage, /aws-access-key-id/);
  assert.match(res.json.hookSpecificOutput.systemMessage, /attempt 1\/3/);
});

test('secrets found: the message tells Claude to rotate, and not to suppress', (t) => {
  const ctx = setup(t);
  const { binDir } = installFakeSonar(ctx.scratch, {
    secrets: { status: 51, stdout: SECRET_REPORT },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  track(writeFile(ctx.scratch, 'src/app.js'), { ...ctx, env });

  const message = stop({ ...ctx, env }).json.hookSpecificOutput.systemMessage;

  assert.match(message, /rotating/);
  assert.match(message, /NOSONAR/);
});

test('secrets clean but full analysis finds issues: still blocks', (t) => {
  const ctx = setup(t);
  const { binDir, logFile } = installFakeSonar(ctx.scratch, {
    secrets: { status: 0 },
    analysis: { status: 51, stdout: ISSUE_REPORT },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  track(writeFile(ctx.scratch, 'src/app.js'), { ...ctx, env });

  const res = stop({ ...ctx, env });

  assert.equal(res.json?.hookSpecificOutput?.decision, 'continue');
  assert.match(res.json.hookSpecificOutput.systemMessage, /S1481/);
  assert.deepEqual(
    readInvocations(logFile).map((call) => call.stage),
    ['secrets', 'analysis'],
  );
});

test('everything clean: silent, and the session state is cleared', (t) => {
  const ctx = setup(t);
  const { binDir } = installFakeSonar(ctx.scratch, {
    secrets: { status: 0 },
    analysis: { status: 0 },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  track(writeFile(ctx.scratch, 'src/app.js'), { ...ctx, env });

  const res = stop({ ...ctx, env });

  assert.equal(res.stdout.trim(), '');
  assert.equal(fs.existsSync(stateDirFor(ctx.pluginData, ctx.sessionId)), false);
});

test('full analysis exit 1 (unauthenticated/unreachable): reports but does not block', (t) => {
  const ctx = setup(t);
  const { binDir } = installFakeSonar(ctx.scratch, {
    secrets: { status: 0 },
    analysis: { status: 1, stderr: 'You are not authenticated' },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  track(writeFile(ctx.scratch, 'src/app.js'), { ...ctx, env });

  const res = stop({ ...ctx, env });

  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /could not complete/);
  assert.match(res.stderr, /sonar auth login/);
});

test('secrets still gate when the full analysis cannot run', (t) => {
  const ctx = setup(t);
  const { binDir } = installFakeSonar(ctx.scratch, {
    secrets: { status: 51, stdout: SECRET_REPORT },
    analysis: { status: 1, stderr: 'You are not authenticated' },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  track(writeFile(ctx.scratch, 'src/app.js'), { ...ctx, env });

  const res = stop({ ...ctx, env });

  assert.equal(res.json?.hookSpecificOutput?.decision, 'continue');
  assert.match(res.json.hookSpecificOutput.systemMessage, /aws-access-key-id/);
});

test('a secrets stage that could not run says the session went ungated', (t) => {
  const ctx = setup(t);
  /*
   * `sonar analyze` refuses to run at all without credentials, exiting 1
   * before it scans anything — so this is not a clean session, it is an
   * unchecked one, and the note has to say which.
   */
  const { binDir } = installFakeSonar(ctx.scratch, {
    secrets: { status: 1, stderr: 'Not authenticated.' },
    analysis: { status: 1, stderr: 'Not authenticated.' },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  track(writeFile(ctx.scratch, 'src/app.js'), { ...ctx, env });

  const res = stop({ ...ctx, env });

  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /NOTHING was scanned for secrets/);
  assert.match(res.stderr, /sonar auth login/);
});

test('full analysis exit 2 is reported as a bug in the hook, and does not block', (t) => {
  const ctx = setup(t);
  const { binDir } = installFakeSonar(ctx.scratch, {
    secrets: { status: 0 },
    analysis: { status: 2, stderr: 'unknown option --file' },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  track(writeFile(ctx.scratch, 'src/app.js'), { ...ctx, env });

  const res = stop({ ...ctx, env });

  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /BUG/);
  assert.match(res.stderr, /did NOT run/);
});

test('attempt cap: blocks 3 times, then reports and lets the stop through', (t) => {
  const ctx = setup(t);
  const { binDir } = installFakeSonar(ctx.scratch, {
    secrets: { status: 51, stdout: SECRET_REPORT },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  track(writeFile(ctx.scratch, 'src/app.js'), { ...ctx, env });

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = stop({ ...ctx, env });
    assert.equal(
      res.json?.hookSpecificOutput?.decision,
      'continue',
      `attempt ${attempt} should block`,
    );
  }

  const final = stop({ ...ctx, env });

  assert.equal(final.stdout.trim(), '');
  assert.match(final.stderr, /findings remain after 3 attempts/);
  assert.match(final.stderr, /without suppressing anything/);
  assert.equal(fs.existsSync(stateDirFor(ctx.pluginData, ctx.sessionId)), false);
});

test('the cap never writes suppressions into the tracked files', (t) => {
  const ctx = setup(t);
  const { binDir } = installFakeSonar(ctx.scratch, {
    secrets: { status: 51, stdout: SECRET_REPORT },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  const original = 'const token = "AKIAIOSFODNN7EXAMPLE";\n';
  const file = writeFile(ctx.scratch, 'src/app.js', original);
  track(file, { ...ctx, env });

  for (let attempt = 0; attempt < 4; attempt++) {
    stop({ ...ctx, env });
  }

  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('SubagentStop echoes its own hook event name in the block payload', (t) => {
  const ctx = setup(t);
  const { binDir } = installFakeSonar(ctx.scratch, {
    secrets: { status: 51, stdout: SECRET_REPORT },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  track(writeFile(ctx.scratch, 'src/app.js'), { ...ctx, env });

  const res = stop({ ...ctx, env, hookEventName: 'SubagentStop' });

  assert.equal(res.json.hookSpecificOutput.hookEventName, 'SubagentStop');
});

test('block_on=secrets skips the full analysis entirely', (t) => {
  const ctx = setup(t);
  const { binDir, logFile } = installFakeSonar(ctx.scratch, {
    secrets: { status: 0 },
    analysis: { status: 51, stdout: ISSUE_REPORT },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir, { CLAUDE_PLUGIN_OPTION_BLOCK_ON: 'secrets' });
  track(writeFile(ctx.scratch, 'src/app.js'), { ...ctx, env });

  const res = stop({ ...ctx, env });

  assert.equal(res.stdout.trim(), '');
  assert.deepEqual(
    readInvocations(logFile).map((call) => call.stage),
    ['secrets'],
  );
});

test('analysis_depth is passed through to the CLI', (t) => {
  const ctx = setup(t);
  const { binDir, logFile } = installFakeSonar(ctx.scratch, {
    secrets: { status: 0 },
    analysis: { status: 0 },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir, {
    CLAUDE_PLUGIN_OPTION_ANALYSIS_DEPTH: 'DEEP',
  });
  track(writeFile(ctx.scratch, 'src/app.js'), { ...ctx, env });

  stop({ ...ctx, env });

  const analysis = readInvocations(logFile).find((call) => call.stage === 'analysis');
  assert.ok(analysis.argv.includes('--depth'));
  assert.equal(analysis.argv[analysis.argv.indexOf('--depth') + 1], 'DEEP');
});

test('connected mode: derives --project and runs from the binding root', (t) => {
  const ctx = setup(t);
  const { binDir, logFile } = installFakeSonar(ctx.scratch, {
    secrets: { status: 0 },
    analysis: { status: 0 },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  writeBinding(ctx.scratch, { projectKey: 'my-project', sonarQubeUri: 'https://sonar.example' });
  track(writeFile(ctx.scratch, 'src/app.js'), { ...ctx, env });

  stop({ ...ctx, env });

  const analysis = readInvocations(logFile).find((call) => call.stage === 'analysis');
  assert.equal(analysis.argv[analysis.argv.indexOf('--project') + 1], 'my-project');
  assert.equal(analysis.cwd, fs.realpathSync(ctx.scratch));
});

test('no connected mode: one group, no --project', (t) => {
  const ctx = setup(t);
  const { binDir, logFile } = installFakeSonar(ctx.scratch, {
    secrets: { status: 0 },
    analysis: { status: 0 },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  track(writeFile(ctx.scratch, 'a.js'), { ...ctx, env });
  track(writeFile(ctx.scratch, 'b.js'), { ...ctx, env });

  stop({ ...ctx, env });

  const analyses = readInvocations(logFile).filter((call) => call.stage === 'analysis');
  assert.equal(analyses.length, 1);
  assert.equal(analyses[0].argv.includes('--project'), false);
});

test('monorepo: each binding gets its own run, project key and cwd', (t) => {
  const ctx = setup(t);
  const { binDir, logFile } = installFakeSonar(ctx.scratch, {
    secrets: { status: 0 },
    analysis: { status: 0 },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  const api = path.join(ctx.scratch, 'packages', 'api');
  const web = path.join(ctx.scratch, 'packages', 'web');
  fs.mkdirSync(api, { recursive: true });
  fs.mkdirSync(web, { recursive: true });
  writeBinding(api, { projectKey: 'api-key' });
  writeBinding(web, { projectKey: 'web-key', sonarCloudOrganization: 'my-org' });

  track(writeFile(ctx.scratch, 'packages/api/src/a.js'), { ...ctx, env });
  track(writeFile(ctx.scratch, 'packages/web/src/b.js'), { ...ctx, env });

  stop({ ...ctx, env });

  const analyses = readInvocations(logFile).filter((call) => call.stage === 'analysis');
  assert.equal(analyses.length, 2);
  assert.deepEqual(
    analyses.map((call) => [call.argv[call.argv.indexOf('--project') + 1], call.cwd]),
    [
      ['api-key', fs.realpathSync(api)],
      ['web-key', fs.realpathSync(web)],
    ],
  );
});

test('a finding in one binding group names that project in the report', (t) => {
  const ctx = setup(t);
  const { binDir } = installFakeSonar(ctx.scratch, {
    secrets: { status: 0 },
    analysis: { status: 51, stdout: ISSUE_REPORT },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  writeBinding(ctx.scratch, { projectKey: 'my-project', sonarCloudOrganization: 'my-org' });
  track(writeFile(ctx.scratch, 'src/app.js'), { ...ctx, env });

  const message = stop({ ...ctx, env }).json.hookSpecificOutput.systemMessage;

  assert.match(message, /my-project/);
  assert.match(message, /SonarQube Cloud org my-org/);
});

test('a deleted file drops out of the set before analysis runs', (t) => {
  const ctx = setup(t);
  const { binDir, logFile } = installFakeSonar(ctx.scratch, {
    secrets: { status: 0 },
    analysis: { status: 0 },
  });
  const env = fakeSonarEnv(ctx.scratch, binDir);
  const kept = writeFile(ctx.scratch, 'kept.js');
  const removed = writeFile(ctx.scratch, 'removed.js');
  track(kept, { ...ctx, env });
  track(removed, { ...ctx, env });
  fs.rmSync(removed);

  stop({ ...ctx, env });

  const secrets = readInvocations(logFile).find((call) => call.stage === 'secrets');
  assert.deepEqual(secrets.argv, ['analyze', 'secrets', kept]);
});
