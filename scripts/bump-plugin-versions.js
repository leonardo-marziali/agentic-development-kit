#!/usr/bin/env node
'use strict';

/*
Bumps the "version" in plugins/<name>/.claude-plugin/plugin.json for every
plugin whose files changed since the previous release. Run by
semantic-release's prepare step (see release.config.js), so the bumped
manifests land in the same `chore(release)` commit as CHANGELOG.md.

Claude Code uses a plugin's version to decide when to refresh its cache, so
a plugin that changed but kept its old version would never reach installed
users.

Usage:
  node scripts/bump-plugin-versions.js <major|minor|patch> [<last-release-tag>]
  node scripts/bump-plugin-versions.js ... --root <dir>   # override the repo root

Without a last-release tag (the first release) every plugin is bumped.
*/

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const PLUGINS_DIR_NAME = 'plugins';
const MANIFEST_RELATIVE_PATH = path.join('.claude-plugin', 'plugin.json');
const RELEASE_TYPES = ['major', 'minor', 'patch'];
const VERSION_FIELD = /("version"\s*:\s*")(\d+\.\d+\.\d+)(")/;

function bumpVersion(version, type) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`Not a plain MAJOR.MINOR.PATCH version: ${version}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  if (type === 'patch') return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown release type "${type}" (expected ${RELEASE_TYPES.join('|')})`);
}

function listPlugins(repoRoot) {
  const pluginsDir = path.join(repoRoot, PLUGINS_DIR_NAME);
  return fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(pluginsDir, name, MANIFEST_RELATIVE_PATH)))
    .sort();
}

function changedPlugins(repoRoot, plugins, sinceRef) {
  if (!sinceRef) return plugins;
  const out = execFileSync(
    'git',
    ['diff', '--name-only', `${sinceRef}..HEAD`, '--', `${PLUGINS_DIR_NAME}/`],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const touched = new Set(
    out
      .split('\n')
      .filter(Boolean)
      .map((file) => file.split('/')[1]),
  );
  return plugins.filter((name) => touched.has(name));
}

// Edits the version string in place rather than re-serializing, so Prettier's
// formatting of the rest of the manifest is left alone.
function bumpManifest(manifestPath, type) {
  const source = fs.readFileSync(manifestPath, 'utf8');
  const match = VERSION_FIELD.exec(source);
  if (!match) throw new Error(`No "version" field in ${manifestPath}`);
  const next = bumpVersion(match[2], type);
  fs.writeFileSync(manifestPath, source.replace(VERSION_FIELD, `$1${next}$3`));
  return { from: match[2], to: next };
}

function run({ type, sinceRef, repoRoot = REPO_ROOT, log = console.log }) {
  if (!RELEASE_TYPES.includes(type)) {
    throw new Error(`Release type must be one of ${RELEASE_TYPES.join('|')}, got "${type}"`);
  }
  const bumped = [];
  for (const name of changedPlugins(repoRoot, listPlugins(repoRoot), sinceRef)) {
    const manifestPath = path.join(repoRoot, PLUGINS_DIR_NAME, name, MANIFEST_RELATIVE_PATH);
    const { from, to } = bumpManifest(manifestPath, type);
    log(`${name}: ${from} -> ${to}`);
    bumped.push(name);
  }
  if (bumped.length === 0) log('No plugin changed since the last release.');
  return bumped;
}

function parseArgs(argv) {
  const positional = [];
  let repoRoot;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') repoRoot = path.resolve(argv[++i]);
    else positional.push(argv[i]);
  }
  return { type: positional[0], sinceRef: positional[1], repoRoot };
}

if (require.main === module) {
  try {
    run(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { bumpVersion, listPlugins, changedPlugins, bumpManifest, run, parseArgs };
