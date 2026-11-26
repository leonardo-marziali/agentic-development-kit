#!/usr/bin/env node
'use strict';

/*
 * Stop / SubagentStop hook: lints only the markdown files this session
 * touched (per track-touched.js), auto-fixes what markdownlint can, and if
 * violations remain, blocks the stop with `decision: "block"` so Claude
 * keeps fixing them. Claude is told that a violation which can only be
 * resolved by forcing incorrect content (e.g. inventing a language for a
 * fenced code block that legitimately has none) should instead be
 * suppressed inline with a markdownlint-disable comment.
 *
 * Inside a git repository only violations on lines that differ from the
 * session base (ad-lfl-kit's scope.js, ±2 lines) block; the rest are
 * reported once on stderr and left alone. `markdownlint --fix` rewrites
 * whole files, so a file that also has violations on unchanged lines is not
 * auto-fixed, and auto-suppression only ever comments changed lines.
 * Outside a repository, for an untracked file, or with the plugin's
 * `whole_files` option on, whole files are checked as before.
 *
 * The loop itself — attempt counting, the cap, the blocking payload, and
 * removing only this hook's own state files — is ad-lfl-kit's runFixLoop.
 * What happens at the cap depends on the plugin's `auto_suppress` user
 * config: off (the default) just reports what's still failing and stops
 * blocking; on writes inline markdownlint-disable comments for the
 * remainder. Editing a user's files to silence a linter is a surprising
 * thing to do unasked, so it's opt-in rather than the default.
 *
 * The analysis and fix steps live in checks.js, shared with the standalone
 * changed-lines CLI (scripts/check-changes.js); this script adds tracking,
 * session bases and the loop around them.
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
  isMarkdownFile,
  groupByConfigDir,
  autoSuppressEnabled,
  wholeFilesEnabled,
  insertSuppressions,
} = require('./lib');
const { fixGroups, analyze, fixTargets, toOutcome } = require('./checks');

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

/*
 * runFixLoop's onCap: attempts have run out, so the stop is going through
 * regardless. Report what's left, and — only when the user opted in via
 * auto_suppress — suppress it inline so the next session starts clean.
 * Only in-scope violations are suppressed: pre-existing ones on lines this
 * session didn't change are not its to silence.
 */
function giveUp(remaining, { outcome, maxAttempts }) {
  const violations = outcome.report;

  if (!autoSuppressEnabled()) {
    process.stderr.write(
      `markdown plugin: markdownlint violations remain after ${maxAttempts} fix attempts; ` +
        'leaving them in place. Enable this plugin\'s "auto_suppress" option to have inline ' +
        'markdownlint-disable comments written for whatever is still failing at the cap.\n' +
        `${violations}\n`,
    );
    return;
  }

  const { inScope } = remaining();
  if (inScope.length > 0) {
    const suppressed = insertSuppressions(inScope);
    process.stderr.write(
      `markdown plugin: markdownlint violations remained after ${maxAttempts} fix attempts; ` +
        'auto-suppressed with inline markdownlint-disable comments instead of looping forever:\n' +
        suppressed
          .map((s) => `  ${s.file}:${s.lineNumber ?? '*'} — ${s.rules.join(', ')}`)
          .join('\n') +
        '\n',
    );
  } else {
    process.stderr.write(
      `markdown plugin: markdownlint violations remain after ${maxAttempts} fix attempts ` +
        `and could not be parsed for auto-suppression; giving up for this session.\n${violations}\n`,
    );
  }
}

function buildMessage({ attempt, maxAttempts, outcome }) {
  const scope = wholeFilesEnabled()
    ? ''
    : 'Only violations on lines this session changed are listed; fix just those. A file that ' +
      'also has violations on unchanged lines was not auto-fixed, so its fixable ones are ' +
      'listed too. ';
  return {
    stopReason: 'Markdown files touched in this session still have markdownlint violations.',
    systemMessage:
      'markdownlint found unresolved issues in markdown files edited this session ' +
      `(attempt ${attempt}/${maxAttempts}):\n\n${outcome.report}\n\n` +
      'Auto-fixable issues were already applied where that was safe. ' +
      scope +
      'Fix the remaining ones directly, ' +
      'respecting any .markdownlint.json/.jsonc/.yaml/.yml in the project. If fixing ' +
      'one properly would mean forcing incorrect content (e.g. inventing a language ' +
      'for a fenced code block that legitimately has none), suppress that specific ' +
      'rule inline instead of forcing a fix: put `<!-- markdownlint-disable-next-line ' +
      'MD040 -->` on the line above it, or `<!-- markdownlint-disable MD040 -->` to ' +
      'cover a wider span. ' +
      (autoSuppressEnabled()
        ? `Whatever's still unresolved after attempt ${maxAttempts} will be auto-suppressed ` +
          'that way, then finish.'
        : `After attempt ${maxAttempts} the loop stops and reports whatever is left.`),
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
    matches: isMarkdownFile,
  });

  const dir = loopStateDir({ dir: sessionDir, input });
  const listFile = path.join(dir, TOUCHED_FILES);
  if (!fs.existsSync(listFile)) return;

  const files = readTrackedFiles(listFile).filter(isMarkdownFile);
  const groups = groupByConfigDir(files);
  // Diff against the session base, so lines already committed stay in scope.
  const ctx = { bases: readSessionBases(sessionDir), notes: new Set() };

  // Set when nothing was fixed, so `check` needn't lint the same files again.
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
      current = null;
      const scoped = analyze(groups, files, ctx);
      const fixable = fixTargets(scoped);
      if (fixable.size === 0) {
        current = scoped;
        return;
      }
      fixGroups(groups, fixable);
    },
    check: () => {
      current = current || analyze(groups, files, ctx);
      return toOutcome(current);
    },
    onCap: (cap) => giveUp(() => current || analyze(groups, files, ctx), cap),
    buildMessage,
  });

  for (const note of ctx.notes) process.stderr.write(`markdown plugin: ${note}\n`);
  if (result.reason === 'error') {
    process.stderr.write(`markdown plugin: lint invocation failed: ${result.error.message}\n`);
  }
}

main();
