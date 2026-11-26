'use strict';

/*
 * The EditorConfig check and fix steps behind the Stop hook
 * (check-and-loop.js) and the standalone changed-lines CLI
 * (scripts/check-changes.js), kept here so both reach the same verdict on
 * the same lines. Nothing here reads hook input or session state: callers
 * pass the files and the bases that decide which lines count as changed.
 *
 * The enforcing tool is the ec4j Gradle or Maven plugin where the project's
 * build declares it, editorconfig-checker everywhere else. ec4j's tasks work
 * over patterns rather than a file list, so a format could reach files this
 * session never touched. A narrowed check proves it can't: format only edits
 * files with violations, and the check just reported all of those. Any finding
 * outside the session means narrowing failed, so that project uses the checker.
 *
 * A tool that cannot run at all throws ToolFailure out of analyze().
 */

const path = require('node:path');
const { scopesFor, partitionByScope, fixableFiles } = require('@leonardo-marziali/ad-lfl-kit');
const { findingLine } = require('./lib');
const { ToolFailure, runChecker, JVM_RUNNERS } = require('./backends');

function fallBackToChecker(group, reason, notes) {
  notes.add(`${group.kind} in ${group.root}: ${reason}; falling back to editorconfig-checker.`);
  group.kind = 'checker';
  group.root = null;
}

function checkGroup(group, { cwd, notes }) {
  if (group.kind !== 'checker') {
    try {
      const findings = JVM_RUNNERS[group.kind]({ files: group.files, root: group.root });
      const touched = new Set(group.files);
      const stray = findings.find(({ file }) => !touched.has(file));
      if (!stray) return findings;
      fallBackToChecker(group, `could not narrow to touched files (saw ${stray.file})`, notes);
    } catch (error) {
      if (!(error instanceof ToolFailure)) throw error;
      fallBackToChecker(group, error.message, notes);
    }
  }
  return runChecker({ files: group.files, cwd });
}

function fixGroup(group, files, { cwd, notes }) {
  try {
    if (group.kind === 'checker') runChecker({ files, cwd, fix: true });
    else JVM_RUNNERS[group.kind]({ files, root: group.root, fix: true });
  } catch (error) {
    // The check that follows reports whatever this left behind.
    if (!(error instanceof ToolFailure)) throw error;
    notes.add(`auto-fix could not run: ${error.message}`);
  }
}

function formatFinding({ file, line, message }, cwd) {
  const location = line > 0 ? `${path.relative(cwd, file)}:${line}` : path.relative(cwd, file);
  return `${location}: ${message}`;
}

function analyze(groups, files, { cwd, notes, bases }) {
  const findings = groups.flatMap((group) => checkGroup(group, { cwd, notes }));
  const scoped = partitionByScope(findings, {
    scopes: scopesFor(files, { bases }),
    getFile: (finding) => finding.file,
    getLine: findingLine,
  });
  if (scoped.outOfScope.length > 0) {
    notes.add(
      `${scoped.outOfScope.length} pre-existing violation(s) on lines this session did not ` +
        'change were not blocked on. Run /editorconfig:fix to clean up whole files:\n' +
        scoped.outOfScope.map((finding) => formatFinding(finding, cwd)).join('\n'),
    );
  }
  return scoped;
}

/*
 * The files an auto-fix may rewrite: those with an in-scope violation and
 * none out of scope, since a fix rewrites the whole file.
 */
function fixTargets(scoped) {
  const withFindings = [...new Set(scoped.inScope.map((finding) => finding.file))];
  return new Set(fixableFiles({ files: withFindings, outOfScopeFiles: scoped.outOfScopeFiles }));
}

function fixGroups(groups, fixable, ctx) {
  for (const group of groups) {
    const groupFiles = group.files.filter((file) => fixable.has(file));
    if (groupFiles.length > 0) fixGroup(group, groupFiles, ctx);
  }
}

function toReport(findings, cwd) {
  return findings.map((finding) => formatFinding(finding, cwd)).join('\n');
}

// One finding in the CLI's tool-neutral shape, on the line scoping used.
function toFinding(finding) {
  return {
    file: finding.file,
    line: findingLine(finding),
    rule: 'editorconfig',
    message: finding.message,
    severity: 'error',
  };
}

module.exports = {
  ToolFailure,
  analyze,
  fixTargets,
  fixGroups,
  formatFinding,
  toReport,
  toFinding,
};
