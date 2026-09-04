'use strict';

/*
Uses throwaway fixture plugins (their own package.json + test script,
shaped as plugins/<name>/scripts/hooks/) so these tests exercise the real
`pnpm test` invocation without recursively re-running an actual plugin's
much slower suite.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  mkScratchDir,
  rmScratchDir,
  uniqueSessionId,
  makeFixturePlugin,
  setFixturePassing,
  stateDirFor,
  seedTouched,
  runHook,
} = require('./helpers');

function verify(sessionId, stateRoot, hookEventName = 'Stop') {
  return runHook(
    'verify-plugin-tests.js',
    { hook_event_name: hookEventName, session_id: sessionId },
    { env: { ADK_HOOKS_STATE_DIR: stateRoot } },
  );
}

test('no touched hook code: no-op, empty stdout', (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const sessionId = uniqueSessionId();

  const res = verify(sessionId, stateRoot);

  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

test('failing suite: blocks with decision continue and records the attempt', (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const fixture = makeFixturePlugin(false);
  t.after(() => rmScratchDir(fixture.root));
  const sessionId = uniqueSessionId();
  seedTouched(stateRoot, sessionId, fixture.hookFile);

  const res = verify(sessionId, stateRoot);

  assert.ok(res.json, `expected JSON stdout, got: ${res.stdout}`);
  assert.equal(res.json.hookSpecificOutput.decision, 'continue');
  assert.match(res.json.hookSpecificOutput.systemMessage, /pnpm test/);
  assert.match(res.json.hookSpecificOutput.systemMessage, /fixture-plugin/);

  const attempts = JSON.parse(
    fs.readFileSync(path.join(stateDirFor(stateRoot, sessionId), 'test-attempts.json'), 'utf8'),
  );
  assert.equal(attempts.count, 1);
});

test("passing suite: silent and clears this hook's own state", (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const fixture = makeFixturePlugin(true);
  t.after(() => rmScratchDir(fixture.root));
  const sessionId = uniqueSessionId();
  seedTouched(stateRoot, sessionId, fixture.hookFile);

  const res = verify(sessionId, stateRoot);

  assert.equal(res.stdout.trim(), '');
  assert.equal(fs.existsSync(stateDirFor(stateRoot, sessionId)), false);
});

test('two touched plugins: both suites run, only the failing one is reported', (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const passing = makeFixturePlugin(true, 'plugin-ok');
  t.after(() => rmScratchDir(passing.root));
  const failing = makeFixturePlugin(false, 'plugin-broken');
  t.after(() => rmScratchDir(failing.root));
  const sessionId = uniqueSessionId();
  seedTouched(stateRoot, sessionId, [passing.hookFile, failing.hookFile]);

  const res = verify(sessionId, stateRoot);

  const message = res.json.hookSpecificOutput.systemMessage;
  assert.match(message, /1 test suite is failing/);
  assert.ok(message.includes(failing.pluginRoot), 'failing plugin must be named in the report');
  assert.ok(
    !message.includes(`--- ${passing.pluginRoot} ---`),
    'passing plugin must not get a failure block',
  );
});

test('attempt cap: blocks 3 times then gives up silently, still failing', (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const fixture = makeFixturePlugin(false);
  t.after(() => rmScratchDir(fixture.root));
  const sessionId = uniqueSessionId();
  seedTouched(stateRoot, sessionId, fixture.hookFile);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = verify(sessionId, stateRoot);
    assert.equal(
      res.json?.hookSpecificOutput?.decision,
      'continue',
      `attempt ${attempt} should block`,
    );
  }

  const finalRes = verify(sessionId, stateRoot);

  assert.equal(finalRes.stdout.trim(), '', '4th attempt should give up silently');
  assert.equal(fs.existsSync(stateDirFor(stateRoot, sessionId)), false);
});

test('fixed on a later attempt: passes and clears state', (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const fixture = makeFixturePlugin(false);
  t.after(() => rmScratchDir(fixture.root));
  const sessionId = uniqueSessionId();
  seedTouched(stateRoot, sessionId, fixture.hookFile);

  const first = verify(sessionId, stateRoot);
  assert.equal(first.json?.hookSpecificOutput?.decision, 'continue');

  setFixturePassing(fixture.pluginRoot, true); // simulate Claude fixing the failure

  const second = verify(sessionId, stateRoot);

  assert.equal(second.stdout.trim(), '');
  assert.equal(fs.existsSync(stateDirFor(stateRoot, sessionId)), false);
});

test('cleanup never touches another hook’s pending state in the same directory', (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const fixture = makeFixturePlugin(true);
  t.after(() => rmScratchDir(fixture.root));
  const sessionId = uniqueSessionId();
  const dir = stateDirFor(stateRoot, sessionId);

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'touched-files.txt'), '/tmp/some.md\n');
  fs.writeFileSync(path.join(dir, 'attempts.json'), JSON.stringify({ count: 1 }));
  seedTouched(stateRoot, sessionId, fixture.hookFile);

  const res = verify(sessionId, stateRoot);

  assert.equal(res.stdout.trim(), '');
  assert.equal(fs.existsSync(dir), true, 'directory must survive — other state is pending');
  assert.equal(fs.existsSync(path.join(dir, 'touched-files.txt')), true);
  assert.equal(fs.existsSync(path.join(dir, 'attempts.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'touched-hook-code.txt')), false);
  assert.equal(fs.existsSync(path.join(dir, 'test-attempts.json')), false);
});

test('SubagentStop hook event name passes through into hookSpecificOutput', (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const fixture = makeFixturePlugin(false);
  t.after(() => rmScratchDir(fixture.root));
  const sessionId = uniqueSessionId();
  seedTouched(stateRoot, sessionId, fixture.hookFile);

  const res = verify(sessionId, stateRoot, 'SubagentStop');

  assert.equal(res.json.hookSpecificOutput.hookEventName, 'SubagentStop');
  assert.equal(res.json.hookSpecificOutput.decision, 'continue');
});
