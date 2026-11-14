'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runDoctor, renderChecks } = require('../doctor');
const { loadLock, MANIFEST } = require('../provision');

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const byName = (checks, name) => checks.find((c) => c.name === name);

test('no install stops after the install check and says to run setup', async (t) => {
  const dir = scratch(t);
  const checks = await runDoctor({ dataDir: dir, root: dir });
  assert.deepEqual(
    checks.map((c) => c.name),
    ['node', 'install'],
  );
  assert.equal(byName(checks, 'install').ok, false);
  assert.match(byName(checks, 'install').detail, /not installed/);
});

test('an install that no longer matches the lock is reported as stale', async (t) => {
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify({ backendVersion: '0.0.0' }));
  const checks = await runDoctor({ dataDir: dir, root: dir });
  assert.match(byName(checks, 'install').detail, /doesn't match sloop\.lock\.json/);
});

test('every check of a broken install runs and reports its own failure', async (t) => {
  const dir = scratch(t);
  const lock = loadLock();
  const [analyzer] = lock.analyzers;
  fs.writeFileSync(
    path.join(dir, MANIFEST),
    JSON.stringify({
      backendVersion: lock.backend.version,
      distribution: 'test',
      backendDir: path.join(dir, 'backend'),
      javaPath: path.join(dir, 'no-java'),
      bundledJre: false,
      analyzers: [
        { key: analyzer.key, sha256: analyzer.sha256, path: path.join(dir, 'missing.jar') },
      ],
    }),
  );

  const checks = await runDoctor({ dataDir: dir, root: dir });
  assert.equal(byName(checks, 'install').ok, true);
  assert.equal(byName(checks, 'java').ok, false);
  assert.match(byName(checks, 'java').detail, /cannot be run/);
  assert.equal(byName(checks, 'backend jar').ok, false);
  assert.match(byName(checks, `analyzer ${analyzer.key}`).detail, /missing\.jar is missing/);
  assert.equal(byName(checks, 'daemon').ok, null);
  assert.match(byName(checks, 'daemon').detail, /not running for/);
});

test('renderChecks marks ok, failed and informational checks', () => {
  assert.equal(
    renderChecks([
      { name: 'a', ok: true, detail: 'fine' },
      { name: 'b', ok: false, detail: 'broken' },
      { name: 'c', ok: null, detail: 'n/a' },
    ]),
    'ok   a: fine\nFAIL b: broken\n--   c: n/a\n',
  );
});
