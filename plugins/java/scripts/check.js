#!/usr/bin/env node
'use strict';

/*
 * /java:check's command: the Stop hook's checks — source rules, build files,
 * NullAway and ArchUnit — over whole files, reporting every finding rather
 * than only those on changed lines. A project without
 * .claude/java-standards.json is checked with the default settings.
 *
 *   node scripts/check.js <file...>
 *   node scripts/check.js --create-archunit-store
 *
 * The second form records the current ArchUnit violations of the repository
 * (from the current directory) in .claude/archunit-store/, the baseline that
 * makes only new violations block in brownfield code.
 *
 * Exit codes: 0 clean (or store created), 1 findings, 2 could not run.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { loadConfig, defaultConfig, findRepoRoot } = require('./hooks/config');
const { moduleInfo } = require('./hooks/module');
const { warnOnce, engineManifest, groupBy, planRepo, check } = require('./hooks/pipeline');
const { runSection } = require('./hooks/archunit');
const { isTrackable } = require('./hooks/lib');

function configFor(repoRoot) {
  // The files were named explicitly, so the config's include/exclude don't filter them out.
  return { ...(loadConfig(repoRoot) || defaultConfig()), include: ['**'], exclude: [] };
}

function checkFiles(files) {
  const manifest = engineManifest();
  const repos = [...groupBy(files, (file) => findRepoRoot(file) || path.dirname(file))].map(
    ([repoRoot, repoFiles]) =>
      planRepo(repoRoot, repoFiles, { config: configFor(repoRoot), format: false }),
  );
  const { failed, report } = check(repos, manifest, { changedLinesOnly: false });
  process.stdout.write(report ? `${report}\n` : 'No findings.\n');
  process.exit(failed ? 1 : 0);
}

// Every module of the repository: the directories of its tracked build files.
function repositoryModules(repoRoot, config) {
  const result = spawnSync(
    'git',
    [
      'ls-files',
      '--',
      'pom.xml',
      '**/pom.xml',
      'build.gradle',
      '**/build.gradle',
      'build.gradle.kts',
      '**/build.gradle.kts',
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
  const roots = [
    ...new Set(
      result.stdout
        .split('\n')
        .filter(Boolean)
        .map((rel) => path.dirname(path.join(repoRoot, rel))),
    ),
  ];
  return new Map(roots.map((root) => [root, { files: [], info: moduleInfo(root, config) }]));
}

function createStore() {
  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) {
    process.stderr.write('java plugin: not inside a git repository.\n');
    process.exit(2);
  }
  const config = configFor(repoRoot);
  const manifest = engineManifest();
  const { analysed } = runSection({
    repoRoot,
    config,
    modules: repositoryModules(repoRoot, config),
    manifest,
    warn: warnOnce,
    createStore: true,
  });
  if (!analysed) {
    process.stderr.write(
      'java plugin: no module could be analysed (see the warnings above), so no ArchUnit baseline was written.\n',
    );
    process.exit(2);
  }
  process.stdout.write(
    `ArchUnit baseline written to ${path.join(repoRoot, '.claude', 'archunit-store')}\n`,
  );
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--create-archunit-store')) {
    createStore();
    return;
  }
  const files = args.map((file) => path.resolve(file)).filter(isTrackable);
  if (files.length === 0) {
    process.stderr.write('java plugin: no .java or build files given.\n');
    process.exit(2);
  }
  checkFiles(files);
}

main();
