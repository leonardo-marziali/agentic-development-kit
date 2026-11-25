#!/usr/bin/env node
'use strict';

/*
 * Stop / SubagentStop hook: analyzes the files this session touched (per
 * track-touched.js) with the local SonarQube for IDE engine — the plugin's
 * `sonarlint` CLI, backed by a warm SLOOP daemon — and, if anything blocking
 * is found, blocks the stop with `decision: "block"` so Claude is handed
 * the findings and keeps working on them.
 *
 * What blocks:
 *
 *   - Any secret, always, under every setting — wherever it is in a touched
 *     file. A credential on disk is a leak regardless of who wrote the line.
 *   - Issues at or above `min_blocking_severity` (default HIGH, i.e.
 *     BLOCKER/CRITICAL/HIGH) on lines this working tree changed vs HEAD. A
 *     one-line edit to an old file doesn't make its existing debt the
 *     session's problem; those findings are reported once and let through.
 *
 * Analysis is fully local: SLOOP runs offline against analyzers installed by
 * the SessionStart hook, so it behaves the same whether the project is on
 * SonarQube Server, SonarQube Cloud, or neither.
 *
 * Unlike the markdown plugin's equivalent there is no auto-fix pass and no
 * auto-suppression at the attempt cap. Writing NOSONAR comments on the way
 * out would quietly bury exactly the findings this plugin exists to surface,
 * and a secret that has already reached disk is never something a hook
 * should be allowed to silence. At the cap the loop reports what is left and
 * lets the session end.
 *
 * The analysis and the blocking policy live in checks.js, shared with the
 * standalone changed-lines CLI (scripts/check-changes.js).
 *
 * A tool failure (SLOOP not installed, a crashed daemon, a timeout) is
 * reported on stderr and never blocks — a session must not be trapped by a
 * broken toolchain — and leaves the session state in place, so the next stop
 * tries again.
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
} = require('@leonardo-marziali/ad-lfl-kit');
const { STATE_NAMESPACE, TOUCHED_FILES, OWN_STATE_FILES, isAnalyzable } = require('./lib');
const { ToolFailure, analyze } = require('./checks');

const PREFIX = 'sonarqube plugin:';

function buildMessage({ attempt, maxAttempts, outcome }) {
  return {
    stopReason: 'Files touched in this session still have SonarQube findings.',
    systemMessage:
      'SonarQube for IDE analysis (local, SLOOP) found unresolved findings in files edited this ' +
      `session (attempt ${attempt}/${maxAttempts}):\n\n${outcome.report}\n\n` +
      'Fix these in the source. A secret must be removed from the file entirely — ' +
      'move it to an environment variable or a secret store — and, because it has ' +
      'already been written to disk and may be in git history, tell the user it needs ' +
      'rotating. Do not silence anything with a NOSONAR comment or by rewriting code ' +
      'purely to dodge a rule; if a finding is a genuine false positive, say which one ' +
      'and why instead of suppressing it. To understand a rule, run the `sonarlint rules ' +
      '--key <rule>` command described in the sonarlint-analysis skill. ' +
      `After attempt ${maxAttempts} the loop stops and reports whatever is left.`,
  };
}

/*
 * runFixLoop's onCap: attempts have run out, so the stop goes through. Report
 * only — nothing is written to the user's files.
 */
function giveUp({ maxAttempts, outcome }) {
  process.stderr.write(
    `${PREFIX} findings remain after ${maxAttempts} attempts; letting the session end ` +
      'without suppressing anything. Resolve these before committing — if any of them ' +
      'is a secret, treat it as leaked and rotate it:\n' +
      `${outcome.report}\n`,
  );
}

function createNotes() {
  const seen = new Set();
  return {
    add: (message) => seen.add(message),
    emit: () => {
      for (const message of seen) process.stderr.write(`${PREFIX} ${message}\n`);
    },
  };
}

function main() {
  const input = readHookInput();
  if (!input) return;

  // A SubagentStop checks only what that subagent touched.
  /*
   * A background command can still have written files after the last tool
   * call; collect them first.
   */
  const sessionDir = stateDir({ sessionId: input.session_id, namespace: STATE_NAMESPACE });
  trackSessionChanges({
    input,
    listFile: path.join(sessionDir, TOUCHED_FILES),
    matches: isAnalyzable,
  });

  const dir = loopStateDir({ dir: sessionDir, input });
  const listFile = path.join(dir, TOUCHED_FILES);
  if (!fs.existsSync(listFile)) return;

  const cwd = input.cwd || process.cwd();
  const files = readTrackedFiles(listFile).filter(isAnalyzable);
  const notes = createNotes();

  const result = runFixLoop({
    input,
    dir,
    stateFiles: OWN_STATE_FILES,
    files,
    // Diff against the session base, so lines already committed stay in scope.
    check: () => analyze(files, { cwd, notes, bases: readSessionBases(sessionDir) }),
    onCap: giveUp,
    buildMessage,
  });

  notes.emit();

  if (result.reason === 'error') {
    const message = result.error instanceof ToolFailure ? result.error.message : result.error.stack;
    process.stderr.write(
      `${PREFIX} local analysis could not run, so the files this session touched were NOT ` +
        `checked; not blocking the session on it.\n${message}\n`,
    );
  }
}

main();
