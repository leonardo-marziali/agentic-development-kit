#!/usr/bin/env node
'use strict';

/*
 * The Stop hook's ruff and pyright check as a standalone command, for places
 * the plugin's hooks can't run (a git pre-commit hook, an account whose
 * policy allows managed hooks only):
 *
 *   node scripts/check-changes.js [--fix] [--format json|text] [--ref <ref>] -- <paths...>
 *
 * It checks the given Python files and blocks only on findings on lines that
 * differ from <ref> (default HEAD), ±2 lines — the same analysis the hook
 * runs (hooks/checks.js), minus the session: no tracking, no session bases,
 * no attempt loop, no auto-suppression. An untracked file, or a file outside
 * any repository, is checked whole. Paths that aren't .py/.pyi files, or
 * sit in a virtualenv, cache or node_modules, are ignored.
 * CLAUDE_PLUGIN_OPTION_WHOLE_FILES is honoured as in the hook.
 *
 * Without --fix nothing is written. With --fix, `ruff check --fix` and then
 * the scoped `ruff format` run once on the files the hook would fix — those
 * with an in-scope ruff finding and no ruff finding out of scope — and the
 * files are checked again.
 *
 * Exit codes: 0 no blocking finding left, 1 blocking findings remain, 2 the
 * check could not run (ruff or pyright missing or failing, a bad argument).
 * --format json prints one object:
 * { plugin, checked, fixed, findings, outOfScope, warnings }.
 */

const { runCheckChanges } = require('@leonardo-marziali/ad-lfl-kit');

const { isPythonFile, isIgnoredPath, groupByConfigDir } = require('./hooks/lib');
const { ruffFix, analyze, fixTargets, toOutcome, toFinding } = require('./hooks/checks');

// The hook's check, and with `fix` its fix step first.
function check(files, { fix, bases }) {
  const notes = new Set();
  const failures = new Set();
  const warn = (message, { failed = false } = {}) => (failed ? failures : notes).add(message);
  const groups = groupByConfigDir(files);
  const ctx = { bases, notes: new Set(), warn };
  let scoped = analyze(groups, files, ctx);
  if (fix) {
    const fixable = fixTargets(scoped);
    if (fixable.size > 0) {
      ruffFix(groups, fixable, ctx);
      ctx.notes.clear();
      scoped = analyze(groups, files, ctx);
    }
  }
  return {
    findings: scoped.inScope.map(toFinding),
    outOfScope: scoped.outOfScope.map(toFinding),
    notes: [...ctx.notes, ...notes],
    failures: [...failures],
    report: toOutcome(scoped).report,
  };
}

const COMMAND = {
  plugin: 'python',
  matches: (file) => isPythonFile(file) && !isIgnoredPath(file),
  check,
};

if (require.main === module) process.exitCode = runCheckChanges(COMMAND, process.argv.slice(2));

module.exports = { COMMAND };
