#!/usr/bin/env node
'use strict';

/*
 * /java:format's command: formats whole Java files with the JDT engine, using
 * the project's Eclipse profile (or, in a project that opted in, the
 * plugin's default).
 *
 *   node scripts/format.js <file...>
 *
 * Exit codes: 0 done, 2 nothing could be formatted (no profile, no engine).
 */

const path = require('node:path');
const { loadConfig, findRepoRoot } = require('./hooks/config');
const { resolveProfile } = require('./hooks/profile');
const { runEngine } = require('./hooks/engine');
const { engineManifest, groupBy, planRepo } = require('./hooks/pipeline');
const { isJavaFile } = require('./hooks/lib');

function fail(message) {
  process.stderr.write(`java plugin: ${message}\n`);
  process.exit(2);
}

function main() {
  const files = process.argv
    .slice(2)
    .map((file) => path.resolve(file))
    .filter(isJavaFile);
  if (files.length === 0) fail('no .java files given.');
  const manifest = engineManifest();
  if (!manifest) process.exit(2);

  for (const [repoRoot, repoFiles] of groupBy(
    files,
    (file) => findRepoRoot(file) || path.dirname(file),
  )) {
    const config = loadConfig(repoRoot);
    const profile = resolveProfile({ repoRoot, config });
    if (!profile) {
      fail(
        `no Eclipse formatter profile found in ${repoRoot}: commit one (an Eclipse "Export profile" XML), or opt in ` +
          "with .claude/java-standards.json to use the plugin's default.",
      );
    }
    const plan = planRepo(repoRoot, repoFiles, { config: null });
    for (const [, module] of plan.modules) {
      const result = runEngine({
        manifest,
        files: module.files.map((file) => ({ path: file, ranges: '*' })),
        profile,
        source: module.info.javaLevel,
        boot: module.info.boot,
        encoding: module.info.encoding,
      });
      for (const error of result.errors)
        process.stderr.write(`java plugin: ${error.path}: ${error.message}\n`);
      for (const file of result.formatted)
        process.stdout.write(`formatted ${path.relative(repoRoot, file)}\n`);
    }
  }
}

main();
