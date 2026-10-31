'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratchDir, rmScratchDir } = require('../../../scripts/__tests__/helpers');
const {
  readSettings,
  isDisabled,
  disable,
  enable,
  parseArgs,
  run,
} = require('../.devcontainer/claude-attribution');

const SCRIPT_PATH = path.join(__dirname, '..', '.devcontainer', 'claude-attribution.js');

function withSettings(initial, fn) {
  const dir = mkScratchDir('adk-claude-attribution-test-');
  const file = path.join(dir, '.claude', 'settings.json');
  if (initial !== undefined) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, initial);
  }
  try {
    fn(file);
  } finally {
    rmScratchDir(dir);
  }
}

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('disable creates the settings file with the empty attribution', () => {
  withSettings(undefined, (file) => {
    disable(file);
    assert.deepEqual(readJson(file), { attribution: { commit: '', pr: '', sessionUrl: false } });
  });
});

test('disable preserves unrelated settings and replaces a custom attribution', () => {
  withSettings(JSON.stringify({ model: 'opus', attribution: { commit: 'x' } }), (file) => {
    disable(file);
    assert.deepEqual(readJson(file), {
      model: 'opus',
      attribution: { commit: '', pr: '', sessionUrl: false },
    });
  });
});

test('disable replaces the file atomically, leaving no temp file behind', () => {
  withSettings(JSON.stringify({ model: 'opus' }), (file) => {
    const before = fs.statSync(file).ino;
    disable(file);
    assert.notEqual(fs.statSync(file).ino, before, 'expected a rename, not an in-place rewrite');
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['settings.json']);
  });
});

test('disable keeps the existing file mode', () => {
  withSettings(JSON.stringify({ model: 'opus' }), (file) => {
    fs.chmodSync(file, 0o600);
    disable(file);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });
});

test('disable writes through a symlinked settings file', () => {
  withSettings(JSON.stringify({ model: 'opus' }), (file) => {
    const target = path.join(path.dirname(file), 'real.json');
    fs.renameSync(file, target);
    fs.symlinkSync(target, file);
    disable(file);
    assert.ok(fs.lstatSync(file).isSymbolicLink());
    assert.equal(readJson(target).model, 'opus');
    assert.ok(isDisabled(readJson(target)));
  });
});

test('enable removes only the attribution key', () => {
  withSettings(JSON.stringify({ model: 'opus', attribution: { commit: '' } }), (file) => {
    enable(file);
    assert.deepEqual(readJson(file), { model: 'opus' });
  });
});

test('enable does not create a missing settings file', () => {
  withSettings(undefined, (file) => {
    enable(file);
    assert.equal(fs.existsSync(file), false);
  });
});

test('isDisabled only matches the exact disabled shape', () => {
  assert.equal(isDisabled({}), false);
  assert.equal(isDisabled({ attribution: { commit: '' } }), false);
  assert.equal(isDisabled({ attribution: { commit: '', pr: '', sessionUrl: false } }), true);
});

test('readSettings rejects invalid JSON and non-objects', () => {
  withSettings('{nope', (file) => assert.throws(() => readSettings(file), /not valid JSON/));
  withSettings('[]', (file) =>
    assert.throws(() => readSettings(file), /must contain a JSON object/),
  );
  withSettings('', (file) => assert.deepEqual(readSettings(file), {}));
});

test('parseArgs requires exactly one action', () => {
  assert.throws(() => parseArgs([]), /Pass one of/);
  assert.throws(() => parseArgs(['--enable', '--disable']), /only one/);
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
  assert.throws(() => parseArgs(['--disable', '--settings']), /needs a file path/);
});

test('run reports status through a disable/enable round trip', () => {
  withSettings(undefined, (file) => {
    assert.match(run(['--status', '--settings', file]), /enabled/);
    run(['--disable', '--settings', file]);
    assert.match(run(['--status', '--settings', file]), /disabled/);
    run(['--enable', '--settings', file]);
    assert.match(run(['--status', '--settings', file]), /enabled/);
  });
});

test('CLI exits non-zero with a message on bad usage', () => {
  const result = spawnSync(process.execPath, [SCRIPT_PATH], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Pass one of/);
});

test('--from-env follows CLAUDE_ATTRIBUTION and ignores an unset value', () => {
  withSettings(undefined, (file) => {
    const args = ['--from-env', '--settings', file];
    assert.match(run(args, {}), /not set/);
    assert.equal(fs.existsSync(file), false);

    run(args, { CLAUDE_ATTRIBUTION: 'false' });
    assert.equal(isDisabled(readSettings(file)), true);

    run(args, { CLAUDE_ATTRIBUTION: 'true' });
    assert.equal(isDisabled(readSettings(file)), false);

    assert.throws(() => run(args, { CLAUDE_ATTRIBUTION: 'maybe' }), /not a boolean/);
  });
});
