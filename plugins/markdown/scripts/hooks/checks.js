'use strict';

/*
 * The markdownlint analysis and fix steps behind the Stop hook
 * (check-and-loop.js) and the standalone changed-lines CLI
 * (scripts/check-changes.js), kept here so both reach the same verdict on
 * the same lines. Nothing in this module reads hook input or session state:
 * callers pass the files, and the session bases (or a ref turned into
 * bases) that decide which lines count as changed.
 *
 * markdownlint-cli only resolves .markdownlint.* config relative to its own
 * process cwd (not per-file, not walking up from cwd), so files are grouped
 * by their nearest config directory (see lib.js) and linted per group with
 * cwd set there — otherwise a config file wouldn't reliably apply.
 */

const path = require('node:path');
const {
  runBin,
  scopesFor,
  partitionByScope,
  fixableFiles,
} = require('@leonardo-marziali/ad-lfl-kit');
const { parseViolationsJson, wholeFilesEnabled, formatViolation } = require('./lib');

function markdownlint(dir, args) {
  return runBin('npx', ['-y', 'markdownlint-cli', ...args], { cwd: dir, encoding: 'utf8' });
}

/*
 * Lints every group with --json. markdownlint-cli writes that to stderr, but
 * npx can add its own notices to either stream, so try both and let
 * parseViolationsJson dig the payload out. A group that failed without a
 * parseable payload (a broken config, a crashed CLI) is kept as raw text:
 * it still blocks, as it did before violations were scoped.
 */
function lintGroups(groups) {
  const violations = [];
  const unparsed = [];
  for (const [dir, groupFiles] of groups) {
    const result = markdownlint(dir, ['--json', ...groupFiles]);
    if (result.error) throw result.error;
    if (result.status === 0) continue;
    const parsed = parseViolationsJson(result.stderr) || parseViolationsJson(result.stdout);
    if (parsed) violations.push(...parsed);
    else unparsed.push(((result.stdout || '') + (result.stderr || '')).trim());
  }
  return { violations, unparsed };
}

function fixGroups(groups, fixable) {
  for (const [dir, groupFiles] of groups) {
    const files = groupFiles.filter((file) => fixable.has(path.resolve(file)));
    if (files.length > 0) markdownlint(dir, ['--fix', ...files]);
  }
}

/*
 * Lints and splits the violations into the ones this session is answerable
 * for and the ones already there. With `whole_files` on, everything is.
 */
function analyze(groups, files, { bases, notes }) {
  const { violations, unparsed } = lintGroups(groups);
  if (wholeFilesEnabled()) {
    return { inScope: violations, outOfScope: [], outOfScopeFiles: new Set(), unparsed };
  }

  const scoped = partitionByScope(violations, {
    scopes: scopesFor(files, { bases }),
    getFile: (violation) => violation.fileName,
    getLine: (violation) => violation.lineNumber,
  });
  if (scoped.outOfScope.length > 0) {
    notes.add(
      `${scoped.outOfScope.length} pre-existing markdownlint violation(s) on lines this ` +
        'session did not change were not blocked on:\n' +
        scoped.outOfScope.map(formatViolation).join('\n'),
    );
  }
  return { ...scoped, unparsed };
}

/*
 * The files `markdownlint --fix` may rewrite: those with an in-scope
 * violation and nothing out of scope, since --fix rewrites whole files.
 */
function fixTargets(scoped) {
  const withFindings = [...new Set(scoped.inScope.map((v) => path.resolve(v.fileName)))];
  return new Set(fixableFiles({ files: withFindings, outOfScopeFiles: scoped.outOfScopeFiles }));
}

function toOutcome({ inScope, unparsed }) {
  const report = [...inScope.map(formatViolation), ...unparsed].join('\n');
  return { failed: report.length > 0, report };
}

// One violation in the CLI's tool-neutral finding shape.
function toFinding(violation) {
  const detail = violation.errorDetail ? ` [${violation.errorDetail}]` : '';
  return {
    file: path.resolve(violation.fileName),
    line: violation.lineNumber ?? null,
    rule: violation.ruleNames.join('/'),
    message: `${violation.ruleDescription}${detail}`,
    severity: 'error',
  };
}

module.exports = { lintGroups, fixGroups, analyze, fixTargets, toOutcome, toFinding };
