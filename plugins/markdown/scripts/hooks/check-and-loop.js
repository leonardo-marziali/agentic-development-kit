#!/usr/bin/env node
'use strict';

/*
 * Stop / SubagentStop hook: lints only the markdown files this session
 * touched (per track-touched.js), auto-fixes what markdownlint can, and if
 * violations remain, blocks the stop with `decision: "continue"` so Claude
 * keeps fixing them. Claude is told that a violation which can only be
 * resolved by forcing incorrect content (e.g. inventing a language for a
 * fenced code block that legitimately has none) should instead be
 * suppressed inline with a markdownlint-disable comment.
 *
 * The loop itself — attempt counting, the cap, the blocking payload, and
 * removing only this hook's own state files — is ad-lfl-kit's runFixLoop.
 * What happens at the cap depends on the plugin's `auto_suppress` user
 * config: off (the default) just reports what's still failing and stops
 * blocking; on writes inline markdownlint-disable comments for the
 * remainder. Editing a user's files to silence a linter is a surprising
 * thing to do unasked, so it's opt-in rather than the default.
 *
 * markdownlint-cli only resolves .markdownlint.* config relative to its own
 * process cwd (not per-file, not walking up from cwd), so files are grouped
 * by their nearest config directory (see lib.js) and linted per group with
 * cwd set there — otherwise a config file wouldn't reliably apply.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  readHookInput,
  stateDir,
  readTrackedFiles,
  runBin,
  runFixLoop,
} = require('@leonardo-marziali/ad-lfl-kit');
const {
  STATE_NAMESPACE,
  TOUCHED_FILES,
  isMarkdownFile,
  groupByConfigDir,
  parseViolationsJson,
  autoSuppressEnabled,
  insertSuppressions,
} = require('./lib');

/*
 * The state directory is keyed by session id and may be shared with other
 * hooks, so cleanup removes only these files and then drops the directory
 * only if that leaves it empty.
 */
const OWN_STATE_FILES = [TOUCHED_FILES, 'attempts.json'];

function lintGroups(groups, extraArgs) {
  let report = '';
  let failed = false;
  for (const [dir, groupFiles] of groups) {
    const result = runBin('npx', ['-y', 'markdownlint-cli', ...extraArgs, ...groupFiles], {
      cwd: dir,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      failed = true;
      report += (result.stdout || '') + (result.stderr || '');
    }
  }
  return { failed, report: report.trim() };
}

/*
Structured version of the check, used only for auto-suppression: gives
back each violation's file/line/rule instead of formatted text.
markdownlint-cli writes --json output to stderr, but npx can add its own
notices to either stream, so try both and let parseViolationsJson dig the
payload out.
*/
function lintGroupsJson(groups) {
  const violations = [];
  for (const [dir, groupFiles] of groups) {
    const result = runBin('npx', ['-y', 'markdownlint-cli', '--json', ...groupFiles], {
      cwd: dir,
      encoding: 'utf8',
    });
    for (const raw of [result.stderr, result.stdout]) {
      const parsed = parseViolationsJson(raw);
      if (parsed) {
        violations.push(...parsed);
        break;
      }
      // Nothing parseable in either stream just means we can't
      // auto-suppress these; the caller falls back to leaving them for
      // the plain-text message.
    }
  }
  return violations;
}

/*
 * runFixLoop's onCap: attempts have run out, so the stop is going through
 * regardless. Report what's left, and — only when the user opted in via
 * auto_suppress — suppress it inline so the next session starts clean.
 */
function giveUp(groups, { outcome, maxAttempts }) {
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

  const jsonViolations = lintGroupsJson(groups);
  if (jsonViolations.length > 0) {
    const suppressed = insertSuppressions(jsonViolations);
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
  return {
    stopReason: 'Markdown files touched in this session still have markdownlint violations.',
    systemMessage:
      'markdownlint found unresolved issues in markdown files edited this session ' +
      `(attempt ${attempt}/${maxAttempts}):\n\n${outcome.report}\n\n` +
      'Auto-fixable issues were already applied. Fix the remaining ones directly, ' +
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

  const dir = stateDir({ sessionId: input.session_id, namespace: STATE_NAMESPACE });
  const listFile = path.join(dir, TOUCHED_FILES);
  if (!fs.existsSync(listFile)) return;

  const files = readTrackedFiles(listFile).filter(isMarkdownFile);
  const groups = groupByConfigDir(files);

  const result = runFixLoop({
    input,
    dir,
    stateFiles: OWN_STATE_FILES,
    files,
    // Auto-fix what markdownlint can fix on its own, per config group.
    fix: () => lintGroups(groups, ['--fix']),
    check: () => lintGroups(groups, []),
    onCap: (cap) => giveUp(groups, cap),
    buildMessage,
  });

  if (result.reason === 'error') {
    process.stderr.write(`markdown plugin: lint invocation failed: ${result.error.message}\n`);
  }
}

main();
