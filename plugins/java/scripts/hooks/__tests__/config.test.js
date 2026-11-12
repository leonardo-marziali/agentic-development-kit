'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchDir, rmScratchDir, writeTree } = require('./helpers');
const { CONFIG_RELATIVE_PATH, loadConfig, isInScope, findRepoRoot } = require('../config');

// Captures what a function writes to stderr while it runs.
function captureStderr(fn) {
  const original = process.stderr.write;
  let captured = '';
  process.stderr.write = (chunk) => {
    captured += chunk;
    return true;
  };
  try {
    return { value: fn(), stderr: captured };
  } finally {
    process.stderr.write = original;
  }
}

function writeConfig(root, value) {
  writeTree(root, {
    [CONFIG_RELATIVE_PATH]: typeof value === 'string' ? value : JSON.stringify(value),
  });
}

describe('loadConfig', () => {
  let root;
  beforeEach(() => {
    root = mkScratchDir();
  });
  afterEach(() => rmScratchDir(root));

  it('returns null when the project has no config file', () => {
    assert.equal(loadConfig(root), null);
  });

  it('returns null and warns once when the file is not valid JSON', () => {
    writeConfig(root, '{ "include": [');
    const { value, stderr } = captureStderr(() => loadConfig(root));
    assert.equal(value, null);
    assert.match(stderr, /java plugin:/);
  });

  it('fills every default for an empty object', () => {
    writeConfig(root, {});
    assert.deepEqual(loadConfig(root), {
      include: ['**'],
      exclude: [],
      formatter: { enabled: true, profile: null, scope: 'changed-lines' },
      checks: { enabled: true, disabledRules: [] },
      nullaway: { enabled: true, annotations: 'auto' },
      archunit: {
        enabled: true,
        basePackage: null,
        packages: [],
        disabledRules: [],
        compile: 'auto',
      },
      javaVersion: null,
    });
  });

  it('keeps values the project sets and defaults the rest', () => {
    writeConfig(root, {
      formatter: { scope: 'file' },
      checks: { disabledRules: ['S6'] },
      archunit: { enabled: false, basePackage: 'com.acme' },
    });
    const config = loadConfig(root);
    assert.deepEqual(config.formatter, { enabled: true, profile: null, scope: 'file' });
    assert.deepEqual(config.checks, { enabled: true, disabledRules: ['S6'] });
    assert.equal(config.archunit.enabled, false);
    assert.equal(config.archunit.basePackage, 'com.acme');
    assert.equal(config.archunit.compile, 'auto');
  });

  it('normalises javaVersion "1.8" to 8', () => {
    writeConfig(root, { javaVersion: '1.8' });
    assert.equal(loadConfig(root).javaVersion, 8);
  });

  it('keeps a numeric javaVersion', () => {
    writeConfig(root, { javaVersion: 11 });
    assert.equal(loadConfig(root).javaVersion, 11);
  });

  it('drops an unparseable javaVersion with a warning', () => {
    writeConfig(root, { javaVersion: 'abc' });
    const { value, stderr } = captureStderr(() => loadConfig(root));
    assert.equal(value.javaVersion, null);
    assert.match(stderr, /java plugin: .*javaVersion/);
  });
});

describe('isInScope', () => {
  const root = path.resolve('/repo');
  const at = (rel) => path.join(root, rel);
  const config = (include, exclude = []) => ({ include, exclude });

  it('scopes to include and drops excluded directories anywhere below it', () => {
    const scoped = config(['src/main/java/com/acme/orders/v2/'], ['**/v1/']);
    assert.equal(isInScope(at('src/main/java/com/acme/orders/v2/A.java'), scoped, root), true);
    assert.equal(isInScope(at('src/main/java/com/acme/orders/v1/A.java'), scoped, root), false);
    assert.equal(isInScope(at('src/main/java/com/acme/orders/v2/v1/A.java'), scoped, root), false);
  });

  it('matches a slash-free directory pattern at any depth', () => {
    const scoped = config(['**'], ['generated/']);
    assert.equal(isInScope(at('a/generated/B.java'), scoped, root), false);
    assert.equal(isInScope(at('a/b/B.java'), scoped, root), true);
  });

  it('re-includes with a negated pattern that comes later', () => {
    const scoped = config(['**'], ['src/', '!src/keep/']);
    assert.equal(isInScope(at('src/keep/K.java'), scoped, root), true);
    assert.equal(isInScope(at('src/other/O.java'), scoped, root), false);
  });

  it('lets the last matching pattern win', () => {
    const scoped = config(['**'], ['!src/keep/', 'src/']);
    assert.equal(isInScope(at('src/keep/K.java'), scoped, root), false);
  });

  it('anchors a pattern with a leading slash to the repository root', () => {
    const scoped = config(['**'], ['/legacy/']);
    assert.equal(isInScope(at('legacy/L.java'), scoped, root), false);
    assert.equal(isInScope(at('src/legacy/L.java'), scoped, root), true);
  });

  it('normalises Windows-style separators in the path', () => {
    const scoped = config(['src/'], []);
    assert.equal(
      isInScope(`${root}${path.sep}src\\main\\A.java`.replaceAll('/', path.sep), scoped, root),
      true,
    );
  });

  it('is false for a file outside the repository', () => {
    assert.equal(isInScope(path.resolve('/elsewhere/A.java'), config(['**']), root), false);
  });
});

describe('findRepoRoot', () => {
  let root;
  beforeEach(() => {
    root = mkScratchDir();
  });
  afterEach(() => rmScratchDir(root));

  it('walks up to the directory holding .git', () => {
    fs.mkdirSync(path.join(root, '.git'));
    writeTree(root, { 'a/b/C.java': '' });
    assert.equal(findRepoRoot(path.join(root, 'a/b/C.java')), root);
  });

  it('returns null outside any repository', () => {
    writeTree(root, { 'a/C.java': '' });
    assert.equal(findRepoRoot(path.join(root, 'a/C.java')), null);
  });
});
