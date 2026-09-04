'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const { mkScratchDir, rmScratchDir, makeFixtureRepo } = require('./helpers');
const {
  loadMarketplacePlugins,
  resolveTargets,
  listFilesToInclude,
  exportPlugin,
  parseArgs,
  run,
} = require('../export-plugins');

const SCRIPT_PATH = path.join(__dirname, '..', 'export-plugins.js');

function twoPluginFixture() {
  return makeFixtureRepo([
    {
      name: 'markdown',
      files: {
        'README.md': '# markdown\n',
        '.claude-plugin/plugin.json': JSON.stringify({ name: 'markdown' }),
        'skills/lint/SKILL.md': '---\nname: lint\n---\nLint stuff.\n',
        '.DS_Store': 'junk',
        'coverage/lcov.info': 'junk',
        'node_modules/leftover/index.js': 'junk',
      },
    },
    {
      name: 'prettier',
      files: {
        'README.md': '# prettier\n',
        '.claude-plugin/plugin.json': JSON.stringify({ name: 'prettier' }),
      },
    },
  ]);
}

test('loadMarketplacePlugins reads names and resolves sources from marketplace.json', (t) => {
  const root = twoPluginFixture();
  t.after(() => rmScratchDir(root));

  const plugins = loadMarketplacePlugins(root);

  assert.deepEqual(
    plugins.map((p) => p.name),
    ['markdown', 'prettier'],
  );
  assert.equal(plugins[0].dir, path.join(root, 'plugins', 'markdown'));
});

test('resolveTargets returns every plugin when no names are given', () => {
  const plugins = [{ name: 'a' }, { name: 'b' }];
  assert.deepEqual(resolveTargets([], plugins), plugins);
  assert.deepEqual(resolveTargets(undefined, plugins), plugins);
});

test('resolveTargets filters to the requested plugins, de-duplicated', () => {
  const plugins = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  assert.deepEqual(resolveTargets(['b', 'a', 'b'], plugins), [{ name: 'b' }, { name: 'a' }]);
});

test('resolveTargets throws and names the known plugins when given an unknown name', () => {
  const plugins = [{ name: 'markdown' }, { name: 'prettier' }];
  assert.throws(
    () => resolveTargets(['nope'], plugins),
    /Unknown plugin\(s\): nope.*markdown, prettier/s,
  );
});

test('listFilesToInclude excludes .DS_Store, coverage/, and node_modules/', (t) => {
  const root = twoPluginFixture();
  t.after(() => rmScratchDir(root));

  const files = listFilesToInclude(path.join(root, 'plugins', 'markdown')).sort();

  assert.deepEqual(
    files,
    ['.claude-plugin/plugin.json', 'README.md', 'skills/lint/SKILL.md'].sort(),
  );
});

test('exportPlugin writes a zip containing exactly the included files with matching content', (t) => {
  const root = twoPluginFixture();
  t.after(() => rmScratchDir(root));
  const outDir = mkScratchDir();
  t.after(() => rmScratchDir(outDir));

  const plugins = loadMarketplacePlugins(root);
  const outputPath = exportPlugin(plugins[0], outDir);

  assert.equal(outputPath, path.join(outDir, 'markdown.zip'));
  assert.ok(fs.existsSync(outputPath));

  const zip = new AdmZip(outputPath);
  const entryNames = zip
    .getEntries()
    .map((e) => e.entryName)
    .sort();
  assert.deepEqual(
    entryNames,
    ['.claude-plugin/plugin.json', 'README.md', 'skills/lint/SKILL.md'].sort(),
  );
  assert.equal(zip.readAsText('README.md'), '# markdown\n');
  assert.equal(zip.readAsText('skills/lint/SKILL.md'), '---\nname: lint\n---\nLint stuff.\n');
});

test('parseArgs treats bare positionals as plugin names and honors --root/--out', () => {
  const parsed = parseArgs(['markdown', '--root', '/tmp/repo', 'prettier', '--out', '/tmp/out']);
  assert.deepEqual(parsed.names, ['markdown', 'prettier']);
  assert.equal(parsed.root, path.resolve('/tmp/repo'));
  assert.equal(parsed.out, path.resolve('/tmp/out'));
});

test('parseArgs defaults --out to <root>/dist', () => {
  const parsed = parseArgs(['--root', '/tmp/repo']);
  assert.equal(parsed.out, path.join(path.resolve('/tmp/repo'), 'dist'));
});

test('run with no plugin names exports every plugin to the output dir', (t) => {
  const root = twoPluginFixture();
  t.after(() => rmScratchDir(root));
  const outDir = path.join(root, 'dist');

  const outputPaths = run(['--root', root, '--out', outDir]);

  assert.deepEqual(outputPaths.map((p) => path.basename(p)).sort(), [
    'markdown.zip',
    'prettier.zip',
  ]);
  assert.ok(fs.existsSync(path.join(outDir, 'markdown.zip')));
  assert.ok(fs.existsSync(path.join(outDir, 'prettier.zip')));
});

test('run with plugin names exports only those, into a single shared directory', (t) => {
  const root = twoPluginFixture();
  t.after(() => rmScratchDir(root));
  const outDir = path.join(root, 'dist');

  const outputPaths = run(['prettier', '--root', root, '--out', outDir]);

  assert.deepEqual(
    outputPaths.map((p) => path.basename(p)),
    ['prettier.zip'],
  );
  assert.equal(fs.existsSync(path.join(outDir, 'markdown.zip')), false);
  assert.equal(path.dirname(outputPaths[0]), outDir);
});

test('run rejects an unknown plugin name and exports nothing', (t) => {
  const root = twoPluginFixture();
  t.after(() => rmScratchDir(root));
  const outDir = path.join(root, 'dist');

  assert.throws(
    () => run(['does-not-exist', '--root', root, '--out', outDir]),
    /Unknown plugin\(s\)/,
  );
  assert.equal(fs.existsSync(outDir), false);
});

test('CLI: no args exits 0 and reports one export line per plugin', (t) => {
  const root = twoPluginFixture();
  t.after(() => rmScratchDir(root));
  const outDir = path.join(root, 'dist');

  const result = spawnSync('node', [SCRIPT_PATH, '--root', root, '--out', outDir], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.match(result.stdout, /Exported .*markdown\.zip/);
  assert.match(result.stdout, /Exported .*prettier\.zip/);
});

test('CLI: unknown plugin name exits non-zero with an error on stderr', (t) => {
  const root = twoPluginFixture();
  t.after(() => rmScratchDir(root));
  const outDir = path.join(root, 'dist');

  const result = spawnSync('node', [SCRIPT_PATH, 'nope', '--root', root, '--out', outDir], {
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown plugin\(s\): nope/);
});
