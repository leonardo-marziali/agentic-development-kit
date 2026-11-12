'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const p = require('../provision');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'java-provision-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// A lock with two fake jars, and an offline directory holding them.
function fakeLock(dir, { corrupt = false } = {}) {
  const fromDir = path.join(dir, 'offline');
  fs.mkdirSync(fromDir);
  const entries = [
    { groupId: 'org.example', artifactId: 'alpha', version: '1.0.0', content: 'alpha-bytes' },
    { groupId: 'org.example', artifactId: 'beta', version: '2.0.0', content: 'beta-bytes' },
  ];
  for (const e of entries) {
    fs.writeFileSync(path.join(fromDir, `${e.artifactId}-${e.version}.jar`), e.content);
  }
  const pin = ({ content, ...coords }) => ({
    ...coords,
    sha256: corrupt ? sha256('something else') : sha256(content),
  });
  return {
    fromDir,
    lock: { minJava: 21, groups: { jdt: [pin(entries[0])], archunit: [pin(entries[1])] } },
  };
}

const JAVA_21 = p.findJava();
const SKIP_WITHOUT_JDK =
  JAVA_21 && JAVA_21.major >= 21 ? false : 'needs a JDK 21+ on JAVA_HOME or PATH';

test('the committed lock pins exact versions with a sha256 for every jar', () => {
  const lock = p.loadLock();
  assert.equal(lock.minJava, 21);
  for (const group of ['jdt', 'errorprone', 'archunit', 'lombok']) {
    assert.ok(lock.groups[group].length > 0, group);
    for (const jar of lock.groups[group]) {
      assert.match(jar.sha256, /^[0-9a-f]{64}$/, jar.artifactId);
      assert.match(
        jar.version,
        /^\d+(\.\d+)*(-[\w.-]+)?$/,
        `${jar.artifactId} pins an exact version`,
      );
    }
  }
});

test('installs every jar from an offline directory and writes the manifest last', async (t) => {
  const dir = scratch(t);
  const { lock, fromDir } = fakeLock(dir);
  const engineSrc = path.join(dir, 'no-sources');

  const manifest = await p.install({
    dataDir: path.join(dir, 'data'),
    lock,
    fromDir,
    engineSrc,
    java: { bin: 'java', javac: 'javac', major: 21 },
  });

  assert.equal(manifest.jars.jdt.length, 1);
  assert.ok(fs.existsSync(manifest.jars.jdt[0]));
  assert.ok(fs.existsSync(path.join(dir, 'data', 'install.json')));
  assert.deepEqual(p.readInstall(path.join(dir, 'data'), { lock, engineSrc }), manifest);
});

test('a checksum mismatch removes the file and writes no manifest', async (t) => {
  const dir = scratch(t);
  const { lock, fromDir } = fakeLock(dir, { corrupt: true });

  await assert.rejects(
    p.install({
      dataDir: path.join(dir, 'data'),
      lock,
      fromDir,
      engineSrc: path.join(dir, 'none'),
      java: { bin: 'java', javac: 'javac', major: 21 },
    }),
    /checksum mismatch/,
  );
  assert.equal(fs.existsSync(path.join(dir, 'data', 'install.json')), false);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'data', 'jars', 'jdt')), []);
});

test('refuses a JDK older than 21', async (t) => {
  const dir = scratch(t);
  const { lock, fromDir } = fakeLock(dir);
  await assert.rejects(
    p.install({
      dataDir: path.join(dir, 'data'),
      lock,
      fromDir,
      java: { bin: 'java', javac: 'javac', major: 17 },
    }),
    /JDK 21 or newer is required/,
  );
});

test('refuses to install without any JDK', async (t) => {
  const dir = scratch(t);
  const { lock, fromDir } = fakeLock(dir);
  await assert.rejects(
    p.install({ dataDir: path.join(dir, 'data'), lock, fromDir, java: null }),
    /JDK 21 or newer is required/,
  );
});

test('readInstall treats a changed engine source as not installed', async (t) => {
  const dir = scratch(t);
  const { lock, fromDir } = fakeLock(dir);
  const engineSrc = path.join(dir, 'src');
  fs.mkdirSync(engineSrc);
  const java = { bin: 'java', javac: 'javac', major: 21 };
  const dataDir = path.join(dir, 'data');
  await p.install({ dataDir, lock, fromDir, engineSrc, java, compile: () => {} });

  assert.ok(p.readInstall(dataDir, { lock, engineSrc }));
  fs.writeFileSync(path.join(engineSrc, 'New.java'), 'class New {}');
  assert.equal(p.readInstall(dataDir, { lock, engineSrc }), null);
});

test('a reinstall leaves the classes another session runs from in place', async (t) => {
  const dir = scratch(t);
  const { lock, fromDir } = fakeLock(dir);
  const engineSrc = path.join(dir, 'engine');
  const source = path.join(engineSrc, 'jdt', 'src', 'Hello.java');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'class Hello {}');
  const java = { bin: 'java', javac: 'javac', major: 21 };
  const dataDir = path.join(dir, 'data');
  const compile = ({ outDir }) => {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'Hello.class'), '');
  };

  const first = await p.install({ dataDir, lock, fromDir, engineSrc, java, compile });
  fs.writeFileSync(source, 'class Hello { int changed; }');
  const second = await p.install({ dataDir, lock, fromDir, engineSrc, java, compile });

  assert.ok(fs.existsSync(path.join(first.classes.jdt, 'Hello.class')));
  assert.notEqual(second.classes.jdt, first.classes.jdt);
  assert.ok(fs.existsSync(path.join(second.classes.jdt, 'Hello.class')));
});

test(
  'compiles each engine source directory against its jar group',
  { skip: SKIP_WITHOUT_JDK },
  async (t) => {
    const dir = scratch(t);
    // No jars: javac would reject the fake ones, which aren't real zip files.
    const lock = { minJava: 21, groups: { jdt: [] } };
    const engineSrc = path.join(dir, 'engine');
    const source = path.join(engineSrc, 'jdt', 'src', 'demo', 'Hello.java');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(
      source,
      'package demo; public class Hello { public static void main(String[] a) {} }',
    );

    const manifest = await p.install({
      dataDir: path.join(dir, 'data'),
      lock,
      engineSrc,
      java: JAVA_21,
    });

    assert.ok(fs.existsSync(path.join(manifest.classes.jdt, 'demo', 'Hello.class')));
  },
);

test('findJava reports the major version of the JDK it finds', { skip: SKIP_WITHOUT_JDK }, () => {
  assert.ok(JAVA_21.major >= 21);
  assert.ok(fs.existsSync(JAVA_21.javac) || JAVA_21.javac === 'javac');
});

test('readInstall treats an install whose JDK has disappeared as not installed', async (t) => {
  const dir = scratch(t);
  const { lock, fromDir } = fakeLock(dir);
  const engineSrc = path.join(dir, 'none');
  const dataDir = path.join(dir, 'data');
  const gone = path.join(dir, 'old-jdk', 'bin');
  await p.install({
    dataDir,
    lock,
    fromDir,
    engineSrc,
    java: { bin: path.join(gone, 'java'), javac: path.join(gone, 'javac'), major: 21 },
  });

  assert.equal(p.readInstall(dataDir, { lock, engineSrc }), null);
});
