'use strict';

/*
Integration suite. The checker tests hit the real `npx editorconfig-checker`,
same as the hook does at runtime, so they need network access or a warm npx
cache. Gradle and Maven are stood in for by fake wrapper scripts that log their
arguments and replay ec4j's output format: they pin down how the hook drives
those tools, not how ec4j behaves.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratchDir, rmScratchDir, uniqueSessionId, runHook } = require('./helpers');

const EDITORCONFIG = [
  'root = true',
  '[*]',
  'indent_style = space',
  'indent_size = 2',
  'end_of_line = lf',
  'trim_trailing_whitespace = true',
  'insert_final_newline = true',
  '',
].join('\n');
const POM = '<project><artifactId>editorconfig-maven-plugin</artifactId></project>\n';
const GRADLE = "plugins { id 'org.ec4j.editorconfig' version '0.1.0' }\n";

function setup(t, { editorconfig = true } = {}) {
  const dir = fs.realpathSync(mkScratchDir());
  t.after(() => rmScratchDir(dir));
  const project = path.join(dir, 'project');
  fs.mkdirSync(project);
  if (editorconfig) fs.writeFileSync(path.join(project, '.editorconfig'), EDITORCONFIG);
  return { project, pluginData: path.join(dir, 'plugin-data'), sessionId: uniqueSessionId() };
}

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function commitAll(project) {
  git(project, 'init', '-q');
  git(project, 'add', '-A');
  git(project, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'init');
}

function touch(ctx, file) {
  const res = runHook(
    'track-touched.js',
    {
      tool_name: 'Write',
      tool_input: { file_path: file },
      session_id: ctx.sessionId,
      cwd: ctx.project,
    },
    { env: { CLAUDE_PLUGIN_DATA: ctx.pluginData } },
  );
  assert.equal(res.status, 0, res.stderr);
}

function stop(ctx, env = {}) {
  return runHook(
    'check-and-loop.js',
    { hook_event_name: 'Stop', session_id: ctx.sessionId, cwd: ctx.project },
    { env: { CLAUDE_PLUGIN_DATA: ctx.pluginData, ...env } },
  );
}

/*
A stand-in for ./mvnw or ./gradlew: appends its argv to calls.log, then prints
check-output.txt and exits 1 when that file exists, 0 otherwise. A format run
removes check-output.txt, the way a real format would clear the violations.
*/
function fakeWrapper(project, name) {
  const script = path.join(project, name);
  fs.writeFileSync(
    script,
    [
      '#!/bin/sh',
      'echo "$*" >> calls.log',
      'case "$*" in *ormat*) rm -f check-output.txt; exit 0;; esac',
      '[ -f check-output.txt ] || exit 0',
      'cat check-output.txt',
      'exit 1',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
}

function calls(project) {
  const log = path.join(project, 'calls.log');
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
}

test('no tracked files: no-op', (t) => {
  const ctx = setup(t);
  const res = stop(ctx);
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
});

test('without an .editorconfig the file is left alone', (t) => {
  const ctx = setup(t, { editorconfig: false });
  const file = path.join(ctx.project, 'a.txt');
  fs.writeFileSync(file, 'trailing  \n');
  touch(ctx, file);

  const res = stop(ctx);

  assert.equal(res.status, 0);
  assert.equal(res.json, undefined);
  assert.equal(fs.readFileSync(file, 'utf8'), 'trailing  \n');
});

test('fixable violations are repaired without blocking', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.project, 'a.txt');
  fs.writeFileSync(file, 'trailing  \nno newline');
  touch(ctx, file);

  const res = stop(ctx);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json, undefined);
  assert.equal(fs.readFileSync(file, 'utf8'), 'trailing\nno newline\n');
});

test('indentation has no auto-fix, so it blocks and names the line', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.project, 'a.txt');
  fs.writeFileSync(file, 'one\n\ttwo\n');
  touch(ctx, file);

  const res = stop(ctx);

  assert.equal(res.json.decision, 'block');
  assert.match(res.json.reason, /a\.txt:2: wrong indent style/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'one\n\ttwo\n');
});

test('Markdown list continuation indent does not block', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.project, 'a.md');
  fs.writeFileSync(file, '1. item\n\n   continued\n');
  touch(ctx, file);

  const res = stop(ctx);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.json, undefined);
});

test('odd indentation outside Markdown still blocks', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.project, 'a.txt');
  fs.writeFileSync(file, 'one\n   two\n');
  touch(ctx, file);

  const res = stop(ctx);

  assert.equal(res.json.decision, 'block');
  assert.match(res.json.reason, /a\.txt:2: wrong amount of left-padding/);
});

test('tabs in Markdown still block', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.project, 'a.md');
  fs.writeFileSync(file, 'one\n\ttwo\n');
  touch(ctx, file);

  const res = stop(ctx);

  assert.equal(res.json.decision, 'block');
  assert.match(res.json.reason, /a\.md:2: wrong indent style/);
});

test('the loop stops blocking at the attempt cap', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.project, 'a.txt');
  fs.writeFileSync(file, 'one\n\ttwo\n');
  touch(ctx, file);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal(stop(ctx).json.decision, 'block');
  }
  const res = stop(ctx);

  assert.equal(res.json, undefined);
  assert.match(res.stderr, /editorconfig plugin: violations remain after 3 fix attempts/);
});

test('old violations in a changed file neither block nor get rewritten', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.project, 'a.txt');
  const padding = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
  fs.writeFileSync(file, `old trailing  \n${padding}\nlast\n`);
  commitAll(ctx.project);
  fs.writeFileSync(file, `old trailing  \n${padding}\nchanged\n`);
  touch(ctx, file);

  const res = stop(ctx);

  assert.equal(res.json, undefined);
  assert.match(res.stderr, /pre-existing/);
  assert.equal(fs.readFileSync(file, 'utf8'), `old trailing  \n${padding}\nchanged\n`);
});

test('a violation on a changed line blocks even beside old violations', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.project, 'a.txt');
  const padding = Array.from({ length: 10 }, (_, i) => `line ${i}`).join('\n');
  fs.writeFileSync(file, `old trailing  \n${padding}\nlast\n`);
  commitAll(ctx.project);
  fs.writeFileSync(file, `old trailing  \n${padding}\nnew trailing  \n`);
  touch(ctx, file);

  const res = stop(ctx);

  assert.equal(res.json.decision, 'block');
  assert.match(res.json.reason, /a\.txt:12: trailing whitespace/);
  assert.doesNotMatch(res.json.reason, /a\.txt:1:/);
  // Auto-fix would rewrite the old line too, so the file is left for Claude.
  assert.match(fs.readFileSync(file, 'utf8'), /^old trailing {2}\n/);
});

test('Maven: checks and formats only the touched files', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.project, 'src', 'a.txt');
  fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, 'x\n');
  fs.writeFileSync(path.join(ctx.project, 'pom.xml'), POM);
  fakeWrapper(ctx.project, 'mvnw');
  fs.writeFileSync(
    path.join(ctx.project, 'check-output.txt'),
    '[ERROR] src/a.txt@1,1: Delete 1 character - violates trim_trailing_whitespace = true, reported by TextLinter\n',
  );
  touch(ctx, file);

  const res = stop(ctx);

  assert.equal(res.json, undefined, res.stdout);
  const log = calls(ctx.project);
  assert.equal(log.length, 3);
  assert.match(log[0], /-Deditorconfig\.includes=src\/a\.txt/);
  assert.match(log[0], /-N/);
  assert.match(log[0], /editorconfig:check/);
  assert.match(log[1], /-Deditorconfig\.includes=src\/a\.txt/);
  assert.match(log[1], /editorconfig:format/);
  assert.match(log[2], /editorconfig:check/);
});

test('Gradle: narrows through the init script', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.project, 'a.txt');
  fs.writeFileSync(file, 'x\n');
  fs.writeFileSync(path.join(ctx.project, 'build.gradle'), GRADLE);
  fakeWrapper(ctx.project, 'gradlew');
  fs.writeFileSync(
    path.join(ctx.project, 'check-output.txt'),
    'a.txt@1,1: Delete 1 character - violates trim_trailing_whitespace = true, reported by TextLinter\n',
  );
  touch(ctx, file);

  const res = stop(ctx);

  assert.equal(res.json, undefined, res.stdout);
  const log = calls(ctx.project);
  assert.match(log[0], /--init-script \S*narrow-includes\.gradle/);
  assert.match(log[0], /-Padk\.editorconfig\.includes=a\.txt/);
  assert.match(log[0], /editorconfigCheck/);
  assert.match(log[1], /editorconfigFormat/);
});

test('a finding outside the session means narrowing failed: never format', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.project, 'a.txt');
  fs.writeFileSync(file, 'x\n');
  fs.writeFileSync(path.join(ctx.project, 'other.txt'), 'y  \n');
  fs.writeFileSync(path.join(ctx.project, 'pom.xml'), POM);
  fakeWrapper(ctx.project, 'mvnw');
  fs.writeFileSync(
    path.join(ctx.project, 'check-output.txt'),
    '[ERROR] other.txt@1,1: Delete 2 characters - violates trim_trailing_whitespace = true, reported by TextLinter\n',
  );
  touch(ctx, file);

  const res = stop(ctx);

  assert.equal(res.json, undefined, res.stdout);
  assert.deepEqual(
    calls(ctx.project).filter((call) => /format/.test(call)),
    [],
  );
  assert.match(res.stderr, /falling back to editorconfig-checker/);
  assert.equal(fs.readFileSync(path.join(ctx.project, 'other.txt'), 'utf8'), 'y  \n');
});

test('a broken build falls back to the checker', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.project, 'a.txt');
  fs.writeFileSync(file, 'trailing  \n');
  fs.writeFileSync(path.join(ctx.project, 'pom.xml'), POM);
  fakeWrapper(ctx.project, 'mvnw');
  fs.writeFileSync(
    path.join(ctx.project, 'check-output.txt'),
    '[ERROR] Could not resolve plugin\n',
  );
  touch(ctx, file);

  const res = stop(ctx);

  assert.equal(res.json, undefined, res.stdout);
  assert.match(res.stderr, /falling back to editorconfig-checker/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'trailing\n');
});

test('a checker that cannot run warns without blocking and keeps state', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.project, 'a.txt');
  fs.writeFileSync(file, 'one\n\ttwo\n');
  touch(ctx, file);
  const bin = path.join(path.dirname(ctx.project), 'bin');
  fs.mkdirSync(bin);
  const fake = path.join(bin, 'editorconfig-checker');
  fs.writeFileSync(fake, '#!/bin/sh\necho "cannot download" >&2\nexit 1\n', { mode: 0o755 });

  const res = stop(ctx, { PATH: `${bin}${path.delimiter}${process.env.PATH}` });

  assert.equal(res.status, 0);
  assert.equal(res.json, undefined);
  assert.match(res.stderr, /could not run.*NOT checked/s);
  assert.match(res.stderr, /cannot download/);
});
