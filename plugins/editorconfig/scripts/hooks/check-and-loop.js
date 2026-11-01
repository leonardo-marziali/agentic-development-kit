#!/usr/bin/env node
'use strict';

/*
 * Stop / SubagentStop hook: enforces each project's .editorconfig on the files
 * this session touched (per track-touched.js), and only on the lines it
 * changed. Whatever can be auto-fixed is; if violations remain on changed
 * lines, the stop is blocked with `decision: "block"` so Claude keeps fixing
 * them. Violations already committed are reported and left alone, and a file
 * with any of those skips auto-fix, because a fix rewrites the whole file.
 *
 * The enforcing tool is the ec4j Gradle or Maven plugin where the project's
 * build declares it, editorconfig-checker everywhere else. ec4j's tasks work
 * over patterns rather than a file list, so a format could reach files this
 * session never touched. A narrowed check proves it can't: format only edits
 * files with violations, and the check just reported all of those. Any finding
 * outside the session means narrowing failed, so that project uses the checker.
 *
 * The loop itself — attempt counting, the cap, the blocking payload, and
 * removing only this hook's own state files — is ad-lfl-kit's runFixLoop.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  readHookInput,
  stateDir,
  loopStateDir,
  readTrackedFiles,
  trackSessionChanges,
  runFixLoop,
  scopesFor,
  partitionByScope,
  fixableFiles,
} = require('@leonardo-marziali/ad-lfl-kit');
const {
  STATE_NAMESPACE,
  TOUCHED_FILES,
  isEnforceable,
  hasEditorconfig,
  groupByBackend,
  findingLine,
} = require('./lib');
const { ToolFailure, runChecker, JVM_RUNNERS } = require('./backends');

const PREFIX = 'editorconfig plugin:';

/*
 * The state directory is keyed by session id and may be shared with other
 * hooks, so cleanup removes only these files and then drops the directory
 * only if that leaves it empty.
 */
const OWN_STATE_FILES = [TOUCHED_FILES, 'attempts.json'];

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

function analyze(groups, files, { cwd, notes }) {
  const findings = groups.flatMap((group) => checkGroup(group, { cwd, notes }));
  const scoped = partitionByScope(findings, {
    scopes: scopesFor(files),
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

function giveUp({ outcome, maxAttempts }) {
  process.stderr.write(
    `${PREFIX} violations remain after ${maxAttempts} fix attempts; leaving them in place.\n` +
      `${outcome.report}\n`,
  );
}

function buildMessage({ attempt, maxAttempts, outcome }) {
  return {
    stopReason: 'Files touched in this session still have EditorConfig violations.',
    systemMessage:
      'EditorConfig violations remain on lines changed in this session ' +
      `(attempt ${attempt}/${maxAttempts}):\n\n${outcome.report}\n\n` +
      'Auto-fixable issues were already applied where that was safe; a file that also has ' +
      'violations on unchanged lines is left for you, so fix only the lines listed. Follow the ' +
      "project's .editorconfig rather than editing it to make the check pass. If a rule " +
      'conflicts with another formatter in this project, tell the user which ones instead of ' +
      `alternating between them. After attempt ${maxAttempts} the loop stops and reports ` +
      'whatever is left.',
  };
}

function main() {
  const input = readHookInput();
  if (!input) return;

  /*
   * A background command can still have written files after the last tool
   * call; collect them first.
   */
  const sessionDir = stateDir({ sessionId: input.session_id, namespace: STATE_NAMESPACE });
  trackSessionChanges({
    input,
    listFile: path.join(sessionDir, TOUCHED_FILES),
    matches: isEnforceable,
  });

  // A SubagentStop checks only what that subagent touched.
  const dir = loopStateDir({ dir: sessionDir, input });
  const listFile = path.join(dir, TOUCHED_FILES);
  if (!fs.existsSync(listFile)) return;

  const cwd = input.cwd || process.cwd();
  const files = readTrackedFiles(listFile)
    .filter(isEnforceable)
    .filter((file) => fs.existsSync(file))
    .filter(hasEditorconfig);
  const groups = groupByBackend(files);
  const ctx = { cwd, notes: new Set() };

  // Set when nothing was fixed, so `check` needn't start a JVM to repeat it.
  let current = null;

  const result = runFixLoop({
    input,
    dir,
    stateFiles: OWN_STATE_FILES,
    files,
    /*
     * Check first: fixableFiles needs to know what's out of scope, so this is
     * the kit's check → fix → re-check ordering, with the re-check as `check`.
     */
    fix: () => {
      const scoped = analyze(groups, files, ctx);
      const withFindings = [...new Set(scoped.inScope.map((finding) => finding.file))];
      const fixable = new Set(
        fixableFiles({ files: withFindings, outOfScopeFiles: scoped.outOfScopeFiles }),
      );
      if (fixable.size === 0) {
        current = scoped;
        return;
      }
      for (const group of groups) {
        const groupFiles = group.files.filter((file) => fixable.has(file));
        if (groupFiles.length > 0) fixGroup(group, groupFiles, ctx);
      }
    },
    check: () => {
      const { inScope } = current || analyze(groups, files, ctx);
      return {
        failed: inScope.length > 0,
        report: inScope.map((finding) => formatFinding(finding, cwd)).join('\n'),
      };
    },
    onCap: giveUp,
    buildMessage,
  });

  for (const note of ctx.notes) process.stderr.write(`${PREFIX} ${note}\n`);

  if (result.reason === 'error') {
    const message = result.error instanceof ToolFailure ? result.error.message : result.error.stack;
    process.stderr.write(
      `${PREFIX} the check could not run, so the files this session touched were NOT checked; ` +
        `not blocking the session on it.\n${message}\n`,
    );
  }
}

main();
