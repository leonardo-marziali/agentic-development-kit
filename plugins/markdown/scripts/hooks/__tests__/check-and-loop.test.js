'use strict';

/*
Integration suite: these hit the real `npx markdownlint-cli`, same as the
hooks do at runtime (confirmed with the user rather than mocking it — a
mock wouldn't have caught the config-discovery bug this suite guards
against). Requires network access or a warm npx cache; each test spawns
real subprocesses so this file is slower than lib.test.js/track-touched.test.js.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchDir, rmScratchDir, uniqueSessionId, runHook } = require('./helpers');

const VIOLATION_MD = '# Title One\n\n# Title Two\n'; // MD025: multiple top-level headings
const FIXED_MD = '# Title One\n\n## Title Two\n';

function track(file, sessionId, scratch, pluginData) {
  return runHook(
    'track-touched.js',
    {
      tool_name: 'Write',
      tool_input: { file_path: file },
      session_id: sessionId,
      cwd: scratch,
    },
    { env: { CLAUDE_PLUGIN_DATA: pluginData } },
  );
}

function stop(sessionId, scratch, pluginData, { hookEventName = 'Stop', autoSuppress } = {}) {
  const env = { CLAUDE_PLUGIN_DATA: pluginData };
  if (autoSuppress !== undefined) {
    env.CLAUDE_PLUGIN_OPTION_AUTO_SUPPRESS = String(autoSuppress);
  }
  return runHook(
    'check-and-loop.js',
    {
      hook_event_name: hookEventName,
      session_id: sessionId,
      cwd: scratch,
    },
    { env },
  );
}

function stateDirFor(pluginData, sessionId) {
  return path.join(pluginData, 'markdown-session-scope', sessionId);
}

test('no tracked files: no-op, empty stdout', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();

  const res = stop(sessionId, scratch, pluginData);

  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

test('genuine violation, nothing fixed: first Stop blocks with decision continue', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();
  const file = path.join(scratch, 'bad.md');
  fs.writeFileSync(file, VIOLATION_MD);
  track(file, sessionId, scratch, pluginData);

  const res = stop(sessionId, scratch, pluginData);

  assert.ok(res.json, `expected JSON stdout, got: ${res.stdout}`);
  assert.equal(res.json.hookSpecificOutput.decision, 'continue');
  assert.match(res.json.hookSpecificOutput.systemMessage, /MD025/);
});

test('violation fixed on disk: next Stop is silent and clears session state', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();
  const file = path.join(scratch, 'bad.md');
  fs.writeFileSync(file, VIOLATION_MD);
  track(file, sessionId, scratch, pluginData);
  stop(sessionId, scratch, pluginData); // attempt 1: blocks

  fs.writeFileSync(file, FIXED_MD); // simulate Claude fixing it

  const res = stop(sessionId, scratch, pluginData);

  assert.equal(res.stdout.trim(), '');
  assert.equal(fs.existsSync(stateDirFor(pluginData, sessionId)), false);
});

test('attempt cap, auto_suppress off (default): gives up without touching the file', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();
  const file = path.join(scratch, 'stubborn.md');
  fs.writeFileSync(file, VIOLATION_MD);
  track(file, sessionId, scratch, pluginData);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = stop(sessionId, scratch, pluginData);
    assert.equal(
      res.json?.hookSpecificOutput?.decision,
      'continue',
      `attempt ${attempt} should block`,
    );
  }

  const finalRes = stop(sessionId, scratch, pluginData);

  assert.equal(
    finalRes.stdout.trim(),
    '',
    '4th attempt should give up silently (no blocking output)',
  );
  assert.equal(fs.existsSync(stateDirFor(pluginData, sessionId)), false);

  assert.equal(
    fs.readFileSync(file, 'utf8'),
    VIOLATION_MD,
    "the user's file must be left exactly as it was when auto-suppression is off",
  );
  assert.match(
    finalRes.stderr,
    /auto_suppress/,
    'giving up should point at the option that would have suppressed it',
  );
});

test('attempt cap, auto_suppress on: suppresses the remaining violation inline', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();
  const file = path.join(scratch, 'stubborn.md');
  fs.writeFileSync(file, VIOLATION_MD);
  track(file, sessionId, scratch, pluginData);

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = stop(sessionId, scratch, pluginData, { autoSuppress: true });
    assert.equal(
      res.json?.hookSpecificOutput?.decision,
      'continue',
      `attempt ${attempt} should block`,
    );
  }

  const finalRes = stop(sessionId, scratch, pluginData, { autoSuppress: true });

  assert.equal(
    finalRes.stdout.trim(),
    '',
    '4th attempt should give up silently (no blocking output)',
  );
  assert.equal(fs.existsSync(stateDirFor(pluginData, sessionId)), false);

  const suppressed = fs.readFileSync(file, 'utf8');
  assert.match(
    suppressed,
    /<!-- markdownlint-disable-next-line MD025 -->\n# Title Two/,
    'the still-unresolved violation should be auto-suppressed inline, right above its line',
  );

  // The suppression should actually resolve it: a fresh session over the
  // now-suppressed file must find nothing left to fix.
  const nextSessionId = uniqueSessionId();
  track(file, nextSessionId, scratch, pluginData);
  const verifyRes = stop(nextSessionId, scratch, pluginData, { autoSuppress: true });
  assert.equal(verifyRes.stdout.trim(), '');
  assert.equal(fs.existsSync(stateDirFor(pluginData, nextSessionId)), false);
});

test('config respected: same-directory .markdownlint.json suppresses the violation', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();
  fs.writeFileSync(path.join(scratch, '.markdownlint.json'), JSON.stringify({ MD025: false }));
  const file = path.join(scratch, 'configured.md');
  fs.writeFileSync(file, VIOLATION_MD);
  track(file, sessionId, scratch, pluginData);

  const res = stop(sessionId, scratch, pluginData);

  assert.equal(res.stdout.trim(), '');
});

test('config respected: monorepo-nested .markdownlint.yaml two directories up', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();
  const pkgDocsDir = path.join(scratch, 'pkgA', 'docs');
  fs.mkdirSync(pkgDocsDir, { recursive: true });
  fs.writeFileSync(path.join(scratch, 'pkgA', '.markdownlint.yaml'), 'MD025: false\n');
  const file = path.join(pkgDocsDir, 'deep.md');
  fs.writeFileSync(file, VIOLATION_MD);
  track(file, sessionId, scratch, pluginData);

  const res = stop(sessionId, scratch, pluginData);

  assert.equal(res.stdout.trim(), '');
});

for (const [ext, content] of [
  ['jsonc', '{\n  // comment\n  "MD025": false\n}\n'],
  ['yml', 'MD025: false\n'],
]) {
  test(`config respected: .markdownlint.${ext} variant`, (t) => {
    const scratch = mkScratchDir();
    t.after(() => rmScratchDir(scratch));
    const pluginData = path.join(scratch, 'plugin-data');
    const sessionId = uniqueSessionId();
    fs.writeFileSync(path.join(scratch, `.markdownlint.${ext}`), content);
    const file = path.join(scratch, 'f.md');
    fs.writeFileSync(file, VIOLATION_MD);
    track(file, sessionId, scratch, pluginData);

    const res = stop(sessionId, scratch, pluginData);

    assert.equal(res.stdout.trim(), '');
  });
}

test('SubagentStop hook event name passes through into hookSpecificOutput', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();
  const file = path.join(scratch, 'bad.md');
  fs.writeFileSync(file, VIOLATION_MD);
  track(file, sessionId, scratch, pluginData);

  const res = stop(sessionId, scratch, pluginData, { hookEventName: 'SubagentStop' });

  assert.equal(res.json.hookSpecificOutput.hookEventName, 'SubagentStop');
  assert.equal(res.json.hookSpecificOutput.decision, 'continue');
});

test('a file with a real violation that was never tracked is never touched or reported', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const pluginData = path.join(scratch, 'plugin-data');
  const sessionId = uniqueSessionId();

  // Simulates a pre-existing file: has a violation, but was never passed
  // through track-touched.js, so the hooks must not touch it.
  const preexisting = path.join(scratch, 'pre-existing.md');
  fs.writeFileSync(preexisting, VIOLATION_MD);

  // A genuinely tracked, already-clean file, so this run does real work.
  const tracked = path.join(scratch, 'tracked.md');
  fs.writeFileSync(tracked, FIXED_MD);
  track(tracked, sessionId, scratch, pluginData);

  const res = stop(sessionId, scratch, pluginData);

  assert.equal(res.stdout.trim(), '');
  assert.equal(
    fs.readFileSync(preexisting, 'utf8'),
    VIOLATION_MD,
    'pre-existing/untracked file must be left exactly as-is',
  );
});
