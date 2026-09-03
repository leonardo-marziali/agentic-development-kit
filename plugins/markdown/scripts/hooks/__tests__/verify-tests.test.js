'use strict';

/*
Uses a throwaway fixture package (its own package.json + test script) so
these tests exercise the real `npm test` invocation without recursively
re-running this plugin's own (much slower) suite.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchDir, rmScratchDir, uniqueSessionId, runHook } = require('./helpers');

function makeFixturePackage(passing) {
  const dir = mkScratchDir('md-plugin-fixture-pkg-');
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      private: true,
      scripts: { test: 'node run-test.js' },
    }),
  );
  fs.writeFileSync(path.join(dir, 'status.txt'), passing ? '0' : '1');
  fs.writeFileSync(
    path.join(dir, 'run-test.js'),
    "process.exit(parseInt(require('fs').readFileSync('status.txt', 'utf8'), 10));\n",
  );
  fs.writeFileSync(path.join(dir, 'dummy.js'), '// tracked hook file stand-in\n');
  return dir;
}

function setFixturePassing(dir, passing) {
  fs.writeFileSync(path.join(dir, 'status.txt'), passing ? '0' : '1');
}

function stateDirFor(pluginData, sessionId) {
  return path.join(pluginData, 'markdown-session-scope', sessionId);
}

function seedTouched(pluginData, sessionId, filePath) {
  const dir = stateDirFor(pluginData, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'touched-hook-code.txt'), filePath + '\n');
}

function verify(sessionId, pluginData, fixtureDir, hookEventName = 'Stop') {
  return runHook(
    'verify-tests.js',
    { hook_event_name: hookEventName, session_id: sessionId },
    {
      env: {
        CLAUDE_PLUGIN_DATA: pluginData,
        MARKDOWN_PLUGIN_TEST_ROOT: fixtureDir,
      },
    },
  );
}

test('no touched hook code: no-op, empty stdout', (t) => {
  const pluginData = mkScratchDir();
  t.after(() => rmScratchDir(pluginData));
  const fixtureDir = makeFixturePackage(true);
  t.after(() => rmScratchDir(fixtureDir));
  const sessionId = uniqueSessionId();

  const res = verify(sessionId, pluginData, fixtureDir);

  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

test('npm test failing: blocks with decision continue and records the attempt', (t) => {
  const pluginData = mkScratchDir();
  t.after(() => rmScratchDir(pluginData));
  const fixtureDir = makeFixturePackage(false);
  t.after(() => rmScratchDir(fixtureDir));
  const sessionId = uniqueSessionId();
  seedTouched(pluginData, sessionId, path.join(fixtureDir, 'dummy.js'));

  const res = verify(sessionId, pluginData, fixtureDir);

  assert.ok(res.json, `expected JSON stdout, got: ${res.stdout}`);
  assert.equal(res.json.hookSpecificOutput.decision, 'continue');
  assert.match(res.json.hookSpecificOutput.systemMessage, /npm test/);

  const attempts = JSON.parse(
    fs.readFileSync(path.join(stateDirFor(pluginData, sessionId), 'test-attempts.json'), 'utf8'),
  );
  assert.equal(attempts.count, 1);
});

test("npm test passing: silent and clears this hook's own state", (t) => {
  const pluginData = mkScratchDir();
  t.after(() => rmScratchDir(pluginData));
  const fixtureDir = makeFixturePackage(true);
  t.after(() => rmScratchDir(fixtureDir));
  const sessionId = uniqueSessionId();
  seedTouched(pluginData, sessionId, path.join(fixtureDir, 'dummy.js'));

  const res = verify(sessionId, pluginData, fixtureDir);

  assert.equal(res.stdout.trim(), '');
  assert.equal(fs.existsSync(stateDirFor(pluginData, sessionId)), false);
});

test('attempt cap: blocks 3 times then gives up silently, still failing', (t) => {
  const pluginData = mkScratchDir();
  t.after(() => rmScratchDir(pluginData));
  const fixtureDir = makeFixturePackage(false);
  t.after(() => rmScratchDir(fixtureDir));
  const sessionId = uniqueSessionId();
  seedTouched(pluginData, sessionId, path.join(fixtureDir, 'dummy.js'));

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = verify(sessionId, pluginData, fixtureDir);
    assert.equal(
      res.json?.hookSpecificOutput?.decision,
      'continue',
      `attempt ${attempt} should block`,
    );
  }

  const finalRes = verify(sessionId, pluginData, fixtureDir);

  assert.equal(finalRes.stdout.trim(), '', '4th attempt should give up silently');
  assert.equal(fs.existsSync(stateDirFor(pluginData, sessionId)), false);
});

test('fixed on a later attempt: passes and clears state', (t) => {
  const pluginData = mkScratchDir();
  t.after(() => rmScratchDir(pluginData));
  const fixtureDir = makeFixturePackage(false);
  t.after(() => rmScratchDir(fixtureDir));
  const sessionId = uniqueSessionId();
  seedTouched(pluginData, sessionId, path.join(fixtureDir, 'dummy.js'));

  const first = verify(sessionId, pluginData, fixtureDir);
  assert.equal(first.json?.hookSpecificOutput?.decision, 'continue');

  setFixturePassing(fixtureDir, true); // simulate Claude fixing the failure

  const second = verify(sessionId, pluginData, fixtureDir);

  assert.equal(second.stdout.trim(), '');
  assert.equal(fs.existsSync(stateDirFor(pluginData, sessionId)), false);
});

test("shared state directory: cleanup never touches check-and-loop.js's pending state", (t) => {
  const pluginData = mkScratchDir();
  t.after(() => rmScratchDir(pluginData));
  const fixtureDir = makeFixturePackage(true);
  t.after(() => rmScratchDir(fixtureDir));
  const sessionId = uniqueSessionId();
  const dir = stateDirFor(pluginData, sessionId);

  /*
  Simulate check-and-loop.js still having a pending markdown violation
  tracked in the same session directory.
  */
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'touched-files.txt'), '/tmp/some.md\n');
  fs.writeFileSync(path.join(dir, 'attempts.json'), JSON.stringify({ count: 1 }));
  seedTouched(pluginData, sessionId, path.join(fixtureDir, 'dummy.js'));

  const res = verify(sessionId, pluginData, fixtureDir);

  assert.equal(res.stdout.trim(), '');
  assert.equal(fs.existsSync(dir), true, "directory must survive — other hook's state is pending");
  assert.equal(fs.existsSync(path.join(dir, 'touched-files.txt')), true);
  assert.equal(fs.existsSync(path.join(dir, 'attempts.json')), true);
  assert.equal(fs.existsSync(path.join(dir, 'touched-hook-code.txt')), false);
  assert.equal(fs.existsSync(path.join(dir, 'test-attempts.json')), false);
});

test('SubagentStop hook event name passes through into hookSpecificOutput', (t) => {
  const pluginData = mkScratchDir();
  t.after(() => rmScratchDir(pluginData));
  const fixtureDir = makeFixturePackage(false);
  t.after(() => rmScratchDir(fixtureDir));
  const sessionId = uniqueSessionId();
  seedTouched(pluginData, sessionId, path.join(fixtureDir, 'dummy.js'));

  const res = verify(sessionId, pluginData, fixtureDir, 'SubagentStop');

  assert.equal(res.json.hookSpecificOutput.hookEventName, 'SubagentStop');
  assert.equal(res.json.hookSpecificOutput.decision, 'continue');
});
