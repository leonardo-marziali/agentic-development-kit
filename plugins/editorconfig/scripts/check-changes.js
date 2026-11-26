#!/usr/bin/env node
'use strict';

/*
 * The Stop hook's EditorConfig check as a standalone command, for places the
 * plugin's hooks can't run (a git pre-commit hook, an account whose policy
 * allows managed hooks only):
 *
 *   node scripts/check-changes.js [--fix] [--format json|text] [--ref <ref>] -- <paths...>
 *
 * It checks the given files against their .editorconfig and blocks only on
 * violations on lines that differ from <ref> (default HEAD), ±2 lines — the
 * same analysis the hook runs (hooks/checks.js), with the same backend
 * choice: the ec4j Maven or Gradle plugin where the build declares it,
 * editorconfig-checker otherwise, and the checker again wherever ec4j can't
 * be narrowed to the given files. An untracked file, or a file outside any
 * repository, is checked whole. Paths under node_modules or .git, and files
 * no .editorconfig applies to, are ignored.
 *
 * Without --fix nothing is written. With --fix, `editorconfig-checker --fix`
 * or ec4j's format runs once on the files the hook would fix — those with an
 * in-scope violation and none out of scope — and the files are checked
 * again.
 *
 * Exit codes: 0 no blocking violation left, 1 blocking violations remain,
 * 2 the check could not run (no usable checker, a crashed tool, a bad
 * argument). --format json prints one object:
 * { plugin, checked, fixed, findings, outOfScope, warnings }.
 */

const { runCheckChanges } = require('@leonardo-marziali/ad-lfl-kit');

const { isEnforceable, hasEditorconfig, groupByBackend } = require('./hooks/lib');
const { analyze, fixTargets, fixGroups, toReport, toFinding } = require('./hooks/checks');

// The hook's check, and with `fix` its fix step first. A ToolFailure throws.
function check(files, { fix, bases }) {
  const cwd = process.cwd();
  const groups = groupByBackend(files);
  const ctx = { cwd, notes: new Set(), bases };
  let scoped = analyze(groups, files, ctx);
  if (fix) {
    const fixable = fixTargets(scoped);
    if (fixable.size > 0) {
      fixGroups(groups, fixable, ctx);
      scoped = analyze(groups, files, ctx);
    }
  }
  return {
    findings: scoped.inScope.map(toFinding),
    outOfScope: scoped.outOfScope.map(toFinding),
    notes: [...ctx.notes],
    failures: [],
    report: toReport(scoped.inScope, cwd),
  };
}

const COMMAND = {
  plugin: 'editorconfig',
  matches: (file) => isEnforceable(file) && hasEditorconfig(file),
  check,
};

if (require.main === module) process.exitCode = runCheckChanges(COMMAND, process.argv.slice(2));

module.exports = { COMMAND };
