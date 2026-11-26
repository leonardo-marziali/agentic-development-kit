#!/usr/bin/env node
'use strict';

/*
 * The prettier plugin's formatting as a standalone changed-lines check, for
 * places the plugin's hooks can't run (a git pre-commit hook, an account
 * whose policy allows managed hooks only):
 *
 *   node scripts/check-changes.js [--fix] [--format json|text] [--ref <ref>] -- <paths...>
 *
 * A finding is a run of lines Prettier would rewrite on or near (±2 lines)
 * the lines that differ from <ref> (default HEAD) — exactly what the
 * PostToolUse hook would write there (hooks/checks.js). Rewrites elsewhere
 * in the file are counted in `outOfScope` and never block. An untracked
 * file, or a file outside any repository, is checked whole, as is every
 * file with CLAUDE_PLUGIN_OPTION_WHOLE_FILES on. Paths under node_modules
 * or .git are ignored, and so is a file Prettier has no parser for or
 * .prettierignore lists.
 *
 * Without --fix nothing is written. With --fix each file is formatted the
 * way the hook formats it, then checked again.
 *
 * Exit codes: 0 nothing in scope left to format, 1 something is, 2 the
 * check could not run (Prettier missing or failing, a file it can't parse,
 * a bad argument). --format json prints one object:
 * { plugin, checked, fixed, findings, outOfScope, warnings }.
 */

const { runCheckChanges } = require('@leonardo-marziali/ad-lfl-kit');

const { isIgnoredPath, formatFile, pendingChanges } = require('./hooks/checks');

function rangeFinding(file, [start, end]) {
  const lines = start === end ? `line ${start}` : `lines ${start}-${end}`;
  return {
    file,
    line: start,
    rule: 'prettier',
    message: `not formatted: Prettier would rewrite ${lines}`,
    severity: 'error',
  };
}

// With `fix`, the hook's formatting first; then what is still left to format.
function check(files, { fix, bases }) {
  const cwd = process.cwd();
  const notes = [];
  const failures = [];
  if (fix) {
    for (const file of files) {
      const result = formatFile(file, cwd, { bases, warn: (message) => notes.push(message) });
      if (!result.ok) failures.push(`could not format ${file}: ${result.reason}`);
    }
  }

  const findings = [];
  const outOfScope = [];
  for (const file of files) {
    const pending = pendingChanges(file, cwd, { bases });
    if (!pending.ok) {
      if (!fix) failures.push(`could not format ${file}: ${pending.reason}`);
      continue;
    }
    findings.push(...pending.inScope.map((range) => rangeFinding(file, range)));
    outOfScope.push(...pending.outOfScope.map((range) => rangeFinding(file, range)));
  }
  return {
    findings,
    outOfScope,
    notes,
    failures,
    report: findings.map((f) => `${f.file}:${f.line}: ${f.message}`).join('\n'),
  };
}

const COMMAND = { plugin: 'prettier', matches: (file) => !isIgnoredPath(file), check };

if (require.main === module) process.exitCode = runCheckChanges(COMMAND, process.argv.slice(2));

module.exports = { COMMAND };
