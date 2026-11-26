#!/usr/bin/env node
'use strict';

/*
 * The Stop hook's local SonarQube for IDE check as a standalone command, for
 * places the plugin's hooks can't run (a git pre-commit hook, an account
 * whose policy allows managed hooks only):
 *
 *   node scripts/check-changes.js [--fix] [--format json|text] [--ref <ref>] -- <paths...>
 *
 * It analyzes the given files with the plugin's `sonarlint` CLI and applies
 * the hook's blocking policy (hooks/checks.js): a secret blocks wherever it
 * is in a file; other issues block at or above
 * CLAUDE_PLUGIN_OPTION_MIN_BLOCKING_SEVERITY (default HIGH) on lines that
 * differ from <ref> (default HEAD), ±2 lines. An untracked file, or a file
 * outside any repository, is checked whole. Paths git ignores, and the
 * build and vendor directories the hook skips outside a repository, are
 * ignored. The engine's data dir is looked up as in the hook (cli/paths.js):
 * SONARLINT_HOME, then CLAUDE_PLUGIN_DATA, then the per-user cache dir.
 *
 * There is no fix step: --fix is accepted and changes nothing.
 *
 * Exit codes: 0 nothing blocking, 1 blocking findings, 2 the check could
 * not run (SLOOP not installed, a crashed daemon, a timeout, a bad
 * argument). --format json prints one object:
 * { plugin, checked, fixed, findings, outOfScope, warnings }.
 */

const { runCheckChanges } = require('@leonardo-marziali/ad-lfl-kit');

const { isAnalyzable } = require('./hooks/lib');
const { analyze } = require('./hooks/checks');

function toFinding(issue) {
  return {
    file: issue.abs,
    line: issue.line ?? null,
    rule: issue.rule,
    message: issue.message,
    severity: issue.severity,
  };
}

// The hook's check; a ToolFailure throws. There is no fix step to run.
function check(files, { fix, bases }) {
  const notes = new Set();
  if (fix) notes.add('the sonarqube check has no fix step; --fix changed nothing.');
  const outcome = analyze(files, { cwd: process.cwd(), notes, bases });
  return {
    findings: outcome.blocking.map(toFinding),
    outOfScope: outcome.outOfScope.map(toFinding),
    notes: [...notes],
    failures: [],
    report: outcome.report,
  };
}

const COMMAND = { plugin: 'sonarqube', matches: isAnalyzable, check };

if (require.main === module) process.exitCode = runCheckChanges(COMMAND, process.argv.slice(2));

module.exports = { COMMAND };
