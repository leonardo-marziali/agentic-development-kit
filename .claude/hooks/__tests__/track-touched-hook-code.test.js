'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  mkScratchDir,
  rmScratchDir,
  uniqueSessionId,
  makeFixturePlugin,
  stateDirFor,
  runHook,
} = require('./helpers');

function track(filePath, sessionId, stateRoot, toolName = 'Edit') {
  return runHook(
    'track-touched-hook-code.js',
    {
      tool_name: toolName,
      tool_input: { file_path: filePath },
      session_id: sessionId,
      cwd: path.dirname(filePath),
    },
    { env: { ADK_HOOKS_STATE_DIR: stateRoot } },
  );
}

function listFileFor(stateRoot, sessionId) {
  return path.join(stateDirFor(stateRoot, sessionId), 'touched-hook-code.txt');
}

test('a .js file under plugins/<name>/scripts/hooks/ is tracked', (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const fixture = makeFixturePlugin(true);
  t.after(() => rmScratchDir(fixture.root));
  const sessionId = uniqueSessionId();

  track(fixture.hookFile, sessionId, stateRoot);

  const contents = fs.readFileSync(listFileFor(stateRoot, sessionId), 'utf8');
  assert.ok(contents.includes(fixture.hookFile));
});

test('a .js file in a second plugin is tracked alongside the first', (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const first = makeFixturePlugin(true, 'plugin-one');
  t.after(() => rmScratchDir(first.root));
  const second = makeFixturePlugin(true, 'plugin-two');
  t.after(() => rmScratchDir(second.root));
  const sessionId = uniqueSessionId();

  track(first.hookFile, sessionId, stateRoot);
  track(second.hookFile, sessionId, stateRoot);

  const lines = fs
    .readFileSync(listFileFor(stateRoot, sessionId), 'utf8')
    .split('\n')
    .filter(Boolean);
  assert.deepEqual(lines.sort(), [first.hookFile, second.hookFile].sort());
});

test('a .js file outside a plugin hooks directory is ignored', (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const sessionId = uniqueSessionId();
  const outsideFile = path.join(scratch, 'outside.js');
  fs.writeFileSync(outsideFile, '// not a hook\n');

  track(outsideFile, sessionId, stateRoot);

  assert.equal(fs.existsSync(listFileFor(stateRoot, sessionId)), false);
});

test("a .js file under a plugin's scripts/ but not scripts/hooks/ is ignored", (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const fixture = makeFixturePlugin(true);
  t.after(() => rmScratchDir(fixture.root));
  const sessionId = uniqueSessionId();

  const otherFile = path.join(fixture.pluginRoot, 'scripts', 'other.js');
  fs.writeFileSync(otherFile, '// not a hook\n');

  track(otherFile, sessionId, stateRoot);

  assert.equal(fs.existsSync(listFileFor(stateRoot, sessionId)), false);
});

test('a non-.js file inside a plugin hooks directory is ignored', (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const fixture = makeFixturePlugin(true);
  t.after(() => rmScratchDir(fixture.root));
  const sessionId = uniqueSessionId();

  const readme = path.join(fixture.hooksDir, 'README.md');
  fs.writeFileSync(readme, '# not code\n');

  track(readme, sessionId, stateRoot);

  assert.equal(fs.existsSync(listFileFor(stateRoot, sessionId)), false);
});

test('dedups repeated edits to the same file', (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const fixture = makeFixturePlugin(true);
  t.after(() => rmScratchDir(fixture.root));
  const sessionId = uniqueSessionId();

  track(fixture.hookFile, sessionId, stateRoot);
  track(fixture.hookFile, sessionId, stateRoot);

  const lines = fs
    .readFileSync(listFileFor(stateRoot, sessionId), 'utf8')
    .split('\n')
    .filter(Boolean);
  assert.equal(lines.length, 1);
});

test('ignores tool names other than Edit/Write', (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const fixture = makeFixturePlugin(true);
  t.after(() => rmScratchDir(fixture.root));
  const sessionId = uniqueSessionId();

  const res = track(fixture.hookFile, sessionId, stateRoot, 'Read');

  assert.equal(res.status, 0);
  assert.equal(fs.existsSync(listFileFor(stateRoot, sessionId)), false);
});

test("ignores a file_path that doesn't exist on disk", (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const fixture = makeFixturePlugin(true);
  t.after(() => rmScratchDir(fixture.root));
  const sessionId = uniqueSessionId();

  track(path.join(fixture.hooksDir, 'never-written.js'), sessionId, stateRoot);

  assert.equal(fs.existsSync(listFileFor(stateRoot, sessionId)), false);
});

test('malformed JSON on stdin: exits 0, does nothing', (t) => {
  const stateRoot = mkScratchDir();
  t.after(() => rmScratchDir(stateRoot));
  const sessionId = uniqueSessionId();

  const { spawnSync } = require('node:child_process');
  const result = spawnSync('node', [path.join(__dirname, '..', 'track-touched-hook-code.js')], {
    input: 'not json',
    encoding: 'utf8',
    env: { ...process.env, ADK_HOOKS_STATE_DIR: stateRoot },
  });

  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(listFileFor(stateRoot, sessionId)), false);
});
