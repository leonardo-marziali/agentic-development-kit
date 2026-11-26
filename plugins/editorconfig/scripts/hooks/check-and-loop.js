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
 * build declares it, editorconfig-checker everywhere else (see checks.js,
 * which holds the analysis and fix steps this hook shares with the
 * standalone changed-lines CLI, scripts/check-changes.js).
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
  readSessionBases,
  SESSION_BASE_FILE,
} = require('@leonardo-marziali/ad-lfl-kit');
const {
  STATE_NAMESPACE,
  TOUCHED_FILES,
  isEnforceable,
  hasEditorconfig,
  groupByBackend,
} = require('./lib');
const { ToolFailure, analyze, fixTargets, fixGroups, toReport } = require('./checks');

const PREFIX = 'editorconfig plugin:';

/*
 * The state directory is keyed by session id and may be shared with other
 * hooks, so cleanup removes only these files and then drops the directory
 * only if that leaves it empty.
 */
/*
 * SESSION_BASE_FILE is written by tracking (see ad-lfl-kit's base.js);
 * clearing it once the loop passes starts the next turn from a fresh base.
 */
const OWN_STATE_FILES = [TOUCHED_FILES, 'attempts.json', SESSION_BASE_FILE];

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
  // Diff against the session base, so lines already committed stay in scope.
  const ctx = { cwd, notes: new Set(), bases: readSessionBases(sessionDir) };

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
      const fixable = fixTargets(scoped);
      if (fixable.size === 0) {
        current = scoped;
        return;
      }
      fixGroups(groups, fixable, ctx);
    },
    check: () => {
      const { inScope } = current || analyze(groups, files, ctx);
      return {
        failed: inScope.length > 0,
        report: toReport(inScope, cwd),
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
