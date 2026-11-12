'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchDir, rmScratchDir, writeTree } = require('./helpers');
const { resolveClasspath } = require('../classpath');

function scratch(t) {
  const dir = mkScratchDir();
  t.after(() => rmScratchDir(dir));
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

// A fake wrapper: records each call, then prints or writes a known classpath.
function fakeWrapper(root, name, body) {
  const file = path.join(root, name);
  fs.writeFileSync(
    file,
    `#!/bin/sh\necho "$@" >> "${root}/calls.log"\necho "JAVA_HOME=$JAVA_HOME" >> "${root}/calls.log"\n${body}\n`,
  );
  fs.chmodSync(file, 0o755);
}

const calls = (root) =>
  fs.existsSync(path.join(root, 'calls.log'))
    ? fs
        .readFileSync(path.join(root, 'calls.log'), 'utf8')
        .split('\n')
        .filter((l) => l && !l.startsWith('JAVA_HOME'))
    : [];

const MAVEN_BODY = `for arg in "$@"; do case "$arg" in -Dmdep.outputFile=*) printf '/m2/a.jar:/m2/lombok-1.18.30.jar' > "\${arg#-Dmdep.outputFile=}";; esac; done`;

test('reads a Maven module classpath through mvnw and lists existing output dirs', (t) => {
  const root = scratch(t);
  writeTree(root, { 'pom.xml': '<project/>', 'target/classes/x': '' });
  fakeWrapper(root, 'mvnw', MAVEN_BODY);

  const result = resolveClasspath({ moduleRoot: root, cacheDir: path.join(root, 'cache') });

  assert.deepEqual(result.classpath, ['/m2/a.jar', '/m2/lombok-1.18.30.jar']);
  assert.deepEqual(result.processorPath, []);
  assert.deepEqual(result.outputDirs, [path.join(root, 'target/classes')]);
  assert.match(calls(root)[0], /dependency:build-classpath .*-Dmdep.includeScope=test/);
});

test('finds the wrapper in a parent directory of a submodule', (t) => {
  const root = scratch(t);
  writeTree(root, { 'pom.xml': '<project/>', 'service/pom.xml': '<project/>' });
  fakeWrapper(root, 'mvnw', MAVEN_BODY);

  assert.ok(
    resolveClasspath({
      moduleRoot: path.join(root, 'service'),
      cacheDir: path.join(root, 'cache'),
    }),
  );
});

test('reads a Gradle module classpath and processor path through an init script', (t) => {
  const root = scratch(t);
  writeTree(root, { 'build.gradle.kts': 'plugins { java }', 'build/classes/java/main/x': '' });
  fakeWrapper(
    root,
    'gradlew',
    `echo "CP /g/a.jar"\necho "AP /g/lombok-1.18.36.jar"\necho "some gradle noise"`,
  );

  const result = resolveClasspath({ moduleRoot: root, cacheDir: path.join(root, 'cache') });

  assert.deepEqual(result.classpath, ['/g/a.jar']);
  assert.deepEqual(result.processorPath, ['/g/lombok-1.18.36.jar']);
  assert.deepEqual(result.outputDirs, [path.join(root, 'build/classes/java/main')]);
  assert.match(calls(root)[0], /-I .*print-classpath\.gradle/);
});

test('serves the second call from the cache and re-resolves after the build file changes', (t) => {
  const root = scratch(t);
  writeTree(root, { 'pom.xml': '<project/>' });
  fakeWrapper(root, 'mvnw', MAVEN_BODY);
  const cacheDir = path.join(root, 'cache');

  resolveClasspath({ moduleRoot: root, cacheDir });
  resolveClasspath({ moduleRoot: root, cacheDir });
  assert.equal(calls(root).length, 1);

  writeTree(root, { 'pom.xml': '<project><!-- changed --></project>' });
  resolveClasspath({ moduleRoot: root, cacheDir });
  assert.equal(calls(root).length, 2);
});

test('runs the wrapper with the given JAVA_HOME', (t) => {
  const root = scratch(t);
  writeTree(root, { 'pom.xml': '<project/>' });
  fakeWrapper(root, 'mvnw', MAVEN_BODY);

  resolveClasspath({ moduleRoot: root, cacheDir: path.join(root, 'cache'), javaHome: '/opt/jdk8' });

  assert.match(fs.readFileSync(path.join(root, 'calls.log'), 'utf8'), /JAVA_HOME=\/opt\/jdk8/);
});

test('returns null with a warning when the build tool fails', (t) => {
  const root = scratch(t);
  writeTree(root, { 'pom.xml': '<project/>' });
  fakeWrapper(root, 'mvnw', 'echo "[ERROR] boom" >&2; exit 1');
  const warnings = [];

  const result = resolveClasspath({
    moduleRoot: root,
    cacheDir: path.join(root, 'cache'),
    warn: (m) => warnings.push(m),
  });

  assert.equal(result, null);
  assert.match(warnings[0], /could not resolve the classpath.*boom/s);
});
