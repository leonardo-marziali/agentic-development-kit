'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratchDir, rmScratchDir, writeTree, initRepo } = require('../hooks/__tests__/helpers');

const SCRIPTS = path.join(__dirname, '..');
const FAKE_ENGINE = path.join(SCRIPTS, 'hooks', '__tests__', 'fake-engine.js');
const FAKE_ARCHUNIT = path.join(SCRIPTS, 'hooks', '__tests__', 'fake-archunit.js');
const POM = '<project>\n  <properties><java.version>17</java.version></properties>\n</project>\n';

function project(t, files) {
  const root = mkScratchDir();
  t.after(() => rmScratchDir(root));
  writeTree(root, { 'pom.xml': POM, ...files });
  const git = initRepo(root);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const env = {
    CLAUDE_PLUGIN_DATA: path.join(root, '.plugin-data'),
    JAVA_PLUGIN_ENGINE_CMD: FAKE_ENGINE,
    JAVA_PLUGIN_ARCHUNIT_CMD: FAKE_ARCHUNIT,
    FAKE_ENGINE_LOG: path.join(root, 'engine.log'),
    FAKE_ARCHUNIT_LOG: path.join(root, 'archunit.log'),
  };
  return { root, env };
}

function cli(script, args, { root, env }) {
  return spawnSync(process.execPath, [path.join(SCRIPTS, script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

const log = (file) =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
const flag = (args, name) => args[args.indexOf(name) + 1];

const A = 'src/main/java/demo/A.java';
const PROFILE =
  '<profiles version="23"><profile kind="CodeFormatterProfile" name="t" version="23"></profile></profiles>\n';

test('format formats whole files with the project profile', (t) => {
  const ctx = project(t, { 'eclipse.xml': PROFILE, [A]: 'class A { // FORMAT_ME\n}\n' });

  const res = cli('format.js', [path.join(ctx.root, A)], ctx);

  assert.equal(res.status, 0, res.stderr);
  const [call] = log(ctx.env.FAKE_ENGINE_LOG);
  assert.match(call.request, /A\.java\t\*\n/);
  assert.equal(flag(call.args, '--rules'), 'off');
  assert.equal(flag(call.args, '--encoding'), 'UTF-8');
  assert.match(res.stdout, /formatted src\/main\/java\/demo\/A\.java/);
});

test('format refuses a project with neither a profile nor the opt-in', (t) => {
  const ctx = project(t, { [A]: 'class A {}\n' });

  const res = cli('format.js', [path.join(ctx.root, A)], ctx);

  assert.equal(res.status, 2);
  assert.match(res.stderr, /no Eclipse formatter profile/);
  assert.deepEqual(log(ctx.env.FAKE_ENGINE_LOG), []);
});

test('check reports every finding, including untouched lines, and exits 1', (t) => {
  const ctx = project(t, { [A]: 'class A {\n    int legacy; // RULE:S3\n}\n' });

  const res = cli('check.js', [path.join(ctx.root, A)], ctx);

  assert.equal(res.status, 1, res.stderr);
  assert.match(res.stdout, /## Source rules[\s\S]*A\.java:2 \[S3\] fake S3 finding/);
  const [call] = log(ctx.env.FAKE_ENGINE_LOG);
  assert.equal(flag(call.args, '--rules'), 'on');
  assert.match(call.request, /A\.java\t-\n/);
});

test('check exits 0 on clean files', (t) => {
  const ctx = project(t, { [A]: 'class A {\n}\n' });
  const res = cli('check.js', [path.join(ctx.root, A)], ctx);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /No findings/);
});

test('--create-archunit-store creates the freeze baseline', (t) => {
  const ctx = project(t, {
    '.claude/java-standards.json': JSON.stringify({ archunit: { basePackage: 'demo' } }),
    'target/classes/demo/A.class': 'cafebabe',
    [A]: 'class A {}\n',
  });
  fs.writeFileSync(path.join(ctx.root, 'mvnw'), '#!/bin/sh\nexit 0\n');
  fs.chmodSync(path.join(ctx.root, 'mvnw'), 0o755);

  const res = cli('check.js', ['--create-archunit-store'], ctx);

  assert.equal(res.status, 0, res.stderr);
  const [call] = log(ctx.env.FAKE_ARCHUNIT_LOG);
  assert.ok(call.includes('--create-store'));
  assert.equal(flag(call, '--store'), path.join(ctx.root, '.claude', 'archunit-store', 'root'));
});

test('--create-archunit-store fails when no module could be analysed', (t) => {
  const ctx = project(t, {
    '.claude/java-standards.json': JSON.stringify({
      archunit: { basePackage: 'demo', compile: 'never' },
    }),
    [A]: 'class A {}\n',
  });

  const res = cli('check.js', ['--create-archunit-store'], ctx);

  assert.equal(res.status, 2);
  assert.doesNotMatch(res.stdout, /baseline written/);
  assert.match(res.stderr, /no module could be analysed/);
});

test('--create-archunit-store compiles first, so the baseline matches the current code', (t) => {
  const ctx = project(t, {
    '.claude/java-standards.json': JSON.stringify({ archunit: { basePackage: 'demo' } }),
    'target/classes/demo/A.class': 'cafebabe',
    [A]: 'class A {}\n',
  });
  fs.writeFileSync(path.join(ctx.root, 'mvnw'), `#!/bin/sh\necho "$@" >> "${ctx.root}/mvnw.log"\n`);
  fs.chmodSync(path.join(ctx.root, 'mvnw'), 0o755);
  const past = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(ctx.root, A), past, past);

  const res = cli('check.js', ['--create-archunit-store'], ctx);

  assert.equal(res.status, 0, res.stderr);
  assert.match(fs.readFileSync(path.join(ctx.root, 'mvnw.log'), 'utf8'), /compile test-compile/);
});
