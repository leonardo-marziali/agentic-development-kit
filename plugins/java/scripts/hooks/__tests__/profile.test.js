'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { mkScratchDir, rmScratchDir, writeTree, initRepo } = require('./helpers');
const { resolveProfile, DEFAULT_PROFILE } = require('../profile');

const ECLIPSE_PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<profiles version="23">
  <profile kind="CodeFormatterProfile" name="Team" version="23">
    <setting id="org.eclipse.jdt.core.formatter.lineSplit" value="100"/>
  </profile>
</profiles>
`;

function repo(t, files) {
  const root = mkScratchDir();
  t.after(() => rmScratchDir(root));
  const git = initRepo(root);
  writeTree(root, files);
  git('add', '-A');
  return root;
}

const withConfig = (profile = null) => ({ formatter: { profile } });

test('uses the profile the config names, relative to the repository root', (t) => {
  const root = repo(t, {
    'config/eclipse.xml': ECLIPSE_PROFILE,
    'other/team.xml': ECLIPSE_PROFILE,
  });
  assert.equal(
    resolveProfile({ repoRoot: root, config: withConfig('config/eclipse.xml') }),
    path.join(root, 'config/eclipse.xml'),
  );
});

test('finds a committed Eclipse formatter profile', (t) => {
  const root = repo(t, { 'pom.xml': '<project/>', 'build/eclipse-formatter.xml': ECLIPSE_PROFILE });
  assert.equal(
    resolveProfile({ repoRoot: root, config: null }),
    path.join(root, 'build/eclipse-formatter.xml'),
  );
});

test('ignores XML files that are not formatter profiles', (t) => {
  const root = repo(t, {
    'pom.xml': '<project/>',
    'cleanup.xml': '<profiles><profile kind="CleanUpProfile"/></profiles>',
  });
  assert.equal(resolveProfile({ repoRoot: root, config: null }), null);
});

test('falls back to Eclipse project preferences', (t) => {
  const root = repo(t, {
    '.settings/org.eclipse.jdt.core.prefs': 'org.eclipse.jdt.core.formatter.lineSplit=100\n',
  });
  assert.equal(
    resolveProfile({ repoRoot: root, config: null }),
    path.join(root, '.settings/org.eclipse.jdt.core.prefs'),
  );
});

test("uses the plugin's default profile only for an opted-in project", (t) => {
  const root = repo(t, { 'pom.xml': '<project/>' });
  assert.equal(resolveProfile({ repoRoot: root, config: withConfig() }), DEFAULT_PROFILE);
  assert.equal(resolveProfile({ repoRoot: root, config: null }), null);
});

test('a configured profile that does not exist falls through with a warning', (t) => {
  const root = repo(t, { 'pom.xml': '<project/>' });
  assert.equal(
    resolveProfile({ repoRoot: root, config: withConfig('missing.xml') }),
    DEFAULT_PROFILE,
  );
});

test('ignores Eclipse preferences that hold no formatter settings', (t) => {
  const root = repo(t, {
    '.settings/org.eclipse.jdt.core.prefs': 'org.eclipse.jdt.core.compiler.source=17\n',
  });
  assert.equal(resolveProfile({ repoRoot: root, config: null }), null);
});

test('ignores untracked Eclipse preferences', (t) => {
  const root = repo(t, { 'pom.xml': '<project/>' });
  writeTree(root, {
    '.settings/org.eclipse.jdt.core.prefs': 'org.eclipse.jdt.core.formatter.lineSplit=100\n',
  });
  assert.equal(resolveProfile({ repoRoot: root, config: null }), null);
});

test("doesn't reread the project's XML files until one of them changes", (t) => {
  const fs = require('node:fs');
  const root = repo(t, { 'pom.xml': '<project/>', 'src/main/resources/beans.xml': '<beans/>' });
  const saved = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = path.join(root, '.plugin-data');
  const original = fs.readFileSync;
  let xmlReads = 0;
  fs.readFileSync = (file, ...rest) => {
    if (String(file).endsWith('.xml') && String(file).startsWith(root)) xmlReads += 1;
    return original(file, ...rest);
  };
  t.after(() => {
    fs.readFileSync = original;
    if (saved === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = saved;
  });

  assert.equal(resolveProfile({ repoRoot: root, config: null }), null);
  assert.ok(xmlReads > 0);
  xmlReads = 0;

  assert.equal(resolveProfile({ repoRoot: root, config: null }), null);
  assert.equal(xmlReads, 0);

  fs.writeFileSync(path.join(root, 'src/main/resources/beans.xml'), ECLIPSE_PROFILE);
  assert.equal(
    resolveProfile({ repoRoot: root, config: null }),
    path.join(root, 'src/main/resources/beans.xml'),
  );
});
