#!/usr/bin/env node
'use strict';

/*
 * The Stop hook's markdownlint check as a standalone command, for places the
 * plugin's hooks can't run (a git pre-commit hook, an account whose policy
 * allows managed hooks only):
 *
 *   node scripts/check-changes.js [--fix] [--format json|text] [--ref <ref>] -- <paths...>
 *
 * It lints the given markdown files and blocks only on violations on lines
 * that differ from <ref> (default HEAD), ±2 lines — the same analysis the
 * hook runs (hooks/checks.js), minus the session: no tracking, no session
 * bases, no attempt loop. An untracked file, or a file outside any
 * repository, is checked whole. Paths that aren't markdown files are
 * ignored. CLAUDE_PLUGIN_OPTION_WHOLE_FILES is honoured as in the hook.
 *
 * Without --fix nothing is written. With --fix, `markdownlint --fix` runs
 * once on the files the hook would fix — those with an in-scope violation
 * and none out of scope — and the files are checked again.
 *
 * Exit codes: 0 no blocking violation left, 1 blocking violations remain,
 * 2 the check could not run (markdownlint missing or crashed, a bad
 * argument). --format json prints one object:
 * { plugin, checked, fixed, findings, outOfScope, warnings }.
 */

const { runCheckChanges } = require('@leonardo-marziali/ad-lfl-kit');

const { isMarkdownFile, groupByConfigDir } = require('./hooks/lib');
const { fixGroups, analyze, fixTargets, toOutcome, toFinding } = require('./hooks/checks');

// The hook's check, and with `fix` its fix step first.
function check(files, { fix, bases }) {
  const groups = groupByConfigDir(files);
  const ctx = { bases, notes: new Set() };
  let scoped = analyze(groups, files, ctx);
  if (fix) {
    const fixable = fixTargets(scoped);
    if (fixable.size > 0) {
      fixGroups(groups, fixable);
      ctx.notes.clear();
      scoped = analyze(groups, files, ctx);
    }
  }
  return {
    findings: scoped.inScope.map(toFinding),
    outOfScope: scoped.outOfScope.map(toFinding),
    notes: [...ctx.notes],
    // A group markdownlint failed on without a readable result was not checked.
    failures: scoped.unparsed.map((text) => `markdownlint failed:\n${text}`),
    report: toOutcome({ inScope: scoped.inScope, unparsed: [] }).report,
  };
}

const COMMAND = { plugin: 'markdown', matches: isMarkdownFile, check };

if (require.main === module) process.exitCode = runCheckChanges(COMMAND, process.argv.slice(2));

module.exports = { COMMAND };
