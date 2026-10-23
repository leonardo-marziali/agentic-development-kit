'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  dataDir,
  defaultCacheDir,
  projectRoot,
  rootHash,
  daemonPaths,
  MAX_SOCKET_PATH,
} = require('../paths');

function withEnv(t, vars) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test('data dir: explicit, then SONARLINT_HOME, then CLAUDE_PLUGIN_DATA, then a cache dir', (t) => {
  withEnv(t, { SONARLINT_HOME: '/a', CLAUDE_PLUGIN_DATA: '/b' });
  assert.equal(dataDir('/x'), path.resolve('/x'));
  assert.equal(dataDir(), path.resolve('/a'));
  delete process.env.SONARLINT_HOME;
  assert.equal(dataDir(), path.resolve('/b'));
  delete process.env.CLAUDE_PLUGIN_DATA;
  assert.equal(dataDir(), defaultCacheDir());
});

test('an unsubstituted ${CLAUDE_PLUGIN_DATA} is ignored, not used as a directory name', (t) => {
  withEnv(t, { SONARLINT_HOME: undefined, CLAUDE_PLUGIN_DATA: '/b' });
  assert.equal(dataDir('${CLAUDE_PLUGIN_DATA}'), path.resolve('/b'));
});

test('project root is the git toplevel, or the directory itself outside git', (t) => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'paths-')));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const nested = path.join(base, 'repo', 'a', 'b');
  fs.mkdirSync(nested, { recursive: true });
  const plain = path.join(base, 'plain');
  fs.mkdirSync(plain);
  require('node:child_process').execFileSync('git', ['init', '-q', path.join(base, 'repo')]);
  assert.equal(projectRoot(nested), path.join(base, 'repo'));
  assert.equal(projectRoot(plain), plain);
});

test('each root gets its own short socket/pid/log names', () => {
  const a = daemonPaths('/p/one');
  const b = daemonPaths('/p/two');
  assert.notEqual(a.socket, b.socket);
  assert.equal(rootHash('/p/one').length, 16);
  if (process.platform !== 'win32') {
    assert.ok(a.socket.length <= MAX_SOCKET_PATH + 24, a.socket);
    assert.ok(a.socket.endsWith('.sock'));
  }
});
