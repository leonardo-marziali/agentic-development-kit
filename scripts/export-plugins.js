#!/usr/bin/env node
'use strict';

/*
Zips plugins for manual "Upload plugin" distribution. Each plugin ends up
as its own <name>.zip so it can be grabbed straight from one output
directory, without having to go dig it out of plugins/<name>/ afterwards.

Usage:
  node scripts/export-plugins.js               # export every plugin
  node scripts/export-plugins.js markdown       # export just "markdown"
  node scripts/export-plugins.js markdown prettier
  node scripts/export-plugins.js --out <dir>    # override the output dir
  node scripts/export-plugins.js --root <dir>   # override the repo root
*/

const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');

const REPO_ROOT = path.resolve(__dirname, '..');
const MARKETPLACE_RELATIVE_PATH = path.join('.claude-plugin', 'marketplace.json');
const DEFAULT_OUT_DIR_NAME = 'dist';

// Never ship these, wherever in a plugin tree they show up.
const EXCLUDED_NAMES = new Set(['.DS_Store', 'coverage', 'node_modules']);

function loadMarketplacePlugins(repoRoot) {
  const marketplacePath = path.join(repoRoot, MARKETPLACE_RELATIVE_PATH);
  const manifest = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));

  return manifest.plugins.map((plugin) => ({
    name: plugin.name,
    dir: path.resolve(repoRoot, plugin.source),
  }));
}

function resolveTargets(names, plugins) {
  if (!names || names.length === 0) return plugins;

  const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]));
  const unknown = names.filter((name) => !byName.has(name));
  if (unknown.length > 0) {
    const known = plugins.map((plugin) => plugin.name).join(', ');
    throw new Error(`Unknown plugin(s): ${unknown.join(', ')}. Known plugins: ${known}`);
  }

  // De-dupe while preserving the order/names the caller asked for.
  return [...new Set(names)].map((name) => byName.get(name));
}

function listFilesToInclude(dir, baseDir = dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (EXCLUDED_NAMES.has(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesToInclude(fullPath, baseDir));
    } else if (entry.isFile()) {
      files.push(path.relative(baseDir, fullPath));
    }
  }

  return files;
}

function exportPlugin(plugin, outDir) {
  const zip = new AdmZip();

  for (const relativePath of listFilesToInclude(plugin.dir)) {
    const zipEntryDir = path.dirname(relativePath);
    zip.addLocalFile(
      path.join(plugin.dir, relativePath),
      zipEntryDir === '.' ? '' : zipEntryDir.split(path.sep).join('/'),
    );
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, `${plugin.name}.zip`);
  zip.writeZip(outputPath);
  return outputPath;
}

function parseArgs(argv) {
  const names = [];
  let root = REPO_ROOT;
  let out;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') {
      i += 1;
      root = path.resolve(argv[i]);
    } else if (arg === '--out') {
      i += 1;
      out = path.resolve(argv[i]);
    } else {
      names.push(arg);
    }
  }

  if (!out) out = path.join(root, DEFAULT_OUT_DIR_NAME);
  return { names, root, out };
}

function run(argv) {
  const { names, root, out } = parseArgs(argv);
  const plugins = loadMarketplacePlugins(root);
  const targets = resolveTargets(names, plugins);
  return targets.map((plugin) => exportPlugin(plugin, out));
}

function main() {
  try {
    const outputPaths = run(process.argv.slice(2));
    for (const outputPath of outputPaths) {
      console.log(`Exported ${path.relative(process.cwd(), outputPath)}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  loadMarketplacePlugins,
  resolveTargets,
  listFilesToInclude,
  exportPlugin,
  parseArgs,
  run,
};
