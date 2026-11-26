#!/usr/bin/env node
'use strict';

/*
 * The Stop hook's Java standard check as a standalone command, for places
 * the plugin's hooks can't run (a git pre-commit hook, an account whose
 * policy allows managed hooks only):
 *
 *   node scripts/check-changes.js [--fix] [--format json|text] [--ref <ref>] -- <paths...>
 *
 * It runs the hook's pipeline (hooks/pipeline.js) on the given .java and
 * build files — the source rules, the build-file checks and the NullAway and
 * ArchUnit sections, each as configured in the repository's
 * .claude/java-standards.json — and blocks only on findings on lines that
 * differ from <ref> (default HEAD), ±2 lines (ArchUnit: in the given files).
 * An untracked file is checked whole. Paths that aren't .java or build
 * files, sit in build output, are outside the configured scope, or are in
 * no git repository (where the hook does nothing either) are ignored.
 * Unlike the hook, it has no 165 s time budget: no section is skipped for
 * time.
 *
 * Without --fix nothing is written: the engine checks without formatting.
 * With --fix the engine first formats the changed ranges with the project's
 * Eclipse profile, as the hook does, then the rules are checked.
 *
 * Exit codes: 0 no blocking finding left, 1 blocking findings remain, 2 the
 * check could not run (the engine not installed or failing, a file it could
 * not parse, a section that had to be skipped, a bad argument).
 * --format json prints one object:
 * { plugin, checked, fixed, findings, outOfScope, warnings }.
 */

const path = require('node:path');
const { runCheckChanges } = require('@leonardo-marziali/ad-lfl-kit');

const { isTrackable } = require('./hooks/lib');
const { findRepoRoot, loadConfig, isInScope } = require('./hooks/config');
const { disableBudget } = require('./hooks/budget');
const pipeline = require('./hooks/pipeline');

function toFinding({ file, line, rule, message }) {
  return {
    file: path.resolve(file),
    line: line ?? null,
    rule,
    message,
    severity: 'error',
  };
}

// The hook's check; with `fix`, its formatting of the changed ranges too.
function check(files, { fix, bases }) {
  disableBudget();
  const notes = new Set();
  const failures = new Set();
  pipeline.setWarningSink((message, { failed }) => (failed ? failures : notes).add(message));

  const repos = [...pipeline.groupBy(files, findRepoRoot)].map(([repoRoot, repoFiles]) =>
    pipeline.planRepo(repoRoot, repoFiles, { bases, format: fix }),
  );
  const needsEngine = repos.some(
    (repo) => repo.javaFiles.length > 0 && (repo.config || repo.profile),
  );
  const manifest = needsEngine ? pipeline.engineManifest() : null;
  const outcome = pipeline.check(repos, manifest);

  // Pre-existing findings only show in the report when something blocks.
  const blocking = outcome.sections.flatMap((section) => section.blocking);
  if (!outcome.failed && outcome.report) notes.add(outcome.report);
  return {
    findings: blocking.map(toFinding),
    outOfScope: outcome.sections.flatMap((section) => section.existing).map(toFinding),
    notes: [...notes],
    failures: [...failures],
    report: outcome.failed ? outcome.report : '',
  };
}

/*
 * The hook's own predicate: a tracked kind of file, in a git repository, and
 * inside that repository's configured include/exclude when it has a config.
 */
const configs = new Map();
function matches(file) {
  if (!isTrackable(file)) return false;
  const repoRoot = findRepoRoot(file);
  if (!repoRoot) return false;
  if (!configs.has(repoRoot)) configs.set(repoRoot, loadConfig(repoRoot));
  const config = configs.get(repoRoot);
  return !config || isInScope(file, config, repoRoot);
}

const COMMAND = { plugin: 'java', matches, check };

if (require.main === module) process.exitCode = runCheckChanges(COMMAND, process.argv.slice(2));

module.exports = { COMMAND };
