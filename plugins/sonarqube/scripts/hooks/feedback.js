#!/usr/bin/env node
'use strict';

/*
 * PostToolUse hook (Edit|Write matcher): the "as you type" half of SonarQube
 * for IDE. Analyzes the one file just edited and hands Claude what it found,
 * as additionalContext, while the change is still in front of it — rather
 * than only at the end of the turn, when the Stop gate runs.
 *
 * Built to be cheap and never in the way:
 *
 *   - It only talks to a daemon that is already running (`--no-start`). The
 *     SessionStart hook warms one in the background; until it's ready, edits
 *     go by unanalyzed and the Stop gate still catches everything. A cold JVM
 *     start (~20s) is never paid inside an edit.
 *   - It never blocks. It only adds context.
 *   - It reports MAJOR/MEDIUM and above, plus every secret, and only on lines
 *     the working tree changed vs HEAD — pre-existing debt in a file Claude
 *     touched is not news about this edit.
 *   - It is silent when there is nothing to say, including when the tool
 *     can't run: the Stop hook is where tool failures get reported.
 *
 * Off with the plugin's `per_edit_feedback` option.
 */

const fs = require('node:fs');
const path = require('node:path');
const { readHookInput, scopesFor, partitionByScope } = require('@leonardo-marziali/ad-lfl-kit');
const {
  isAnalyzable,
  isSecret,
  perEditFeedbackEnabled,
  runSonarlint,
  parseAnalysis,
} = require('./lib');
const { rank } = require('../../cli/severity');

const FEEDBACK_THRESHOLD = 'MEDIUM';
const ANALYSIS_TIMEOUT_S = 15;
const MAX_LINES = 15;

function main() {
  if (!perEditFeedbackEnabled()) return;
  const input = readHookInput();
  if (!input || !/^(Edit|Write)$/.test(input.tool_name || '')) return;

  const filePath = input.tool_input?.file_path;
  if (!filePath) return;
  const cwd = input.cwd || process.cwd();
  const abs = path.resolve(cwd, filePath);
  if (!fs.existsSync(abs) || !isAnalyzable(abs)) return;

  const parsed = parseAnalysis(
    runSonarlint(
      [
        'files',
        abs,
        '--format',
        'json',
        '--min-severity',
        FEEDBACK_THRESHOLD,
        '--no-start',
        '--timeout',
        String(ANALYSIS_TIMEOUT_S),
      ],
      { cwd, timeoutMs: (ANALYSIS_TIMEOUT_S + 3) * 1000 },
    ),
  );
  if (!parsed.ok) return;

  const relevant = parsed.result.issues
    .map((issue) => ({ ...issue, abs }))
    .filter((issue) => isSecret(issue) || rank(issue.severity) >= rank(FEEDBACK_THRESHOLD));
  const { inScope } = partitionByScope(
    relevant.filter((issue) => !isSecret(issue)),
    { scopes: scopesFor([abs]), getFile: (i) => i.abs, getLine: (i) => i.line },
  );
  const report = [...relevant.filter(isSecret), ...inScope];
  if (report.length === 0) return;

  const rel = path.relative(cwd, abs) || abs;
  const lines = report.slice(0, MAX_LINES).map((issue) => {
    const fix = issue.hasQuickFix ? ' (quick fix available)' : '';
    return `- line ${issue.line ?? '?'} ${issue.severity} ${issue.rule}: ${issue.message}${fix}`;
  });
  if (report.length > MAX_LINES) lines.push(`- … ${report.length - MAX_LINES} more`);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          `SonarQube for IDE (local analysis) found ${report.length} issue(s) in ${rel} on the lines just changed:\n` +
          `${lines.join('\n')}\n` +
          'Fix the BLOCKER/CRITICAL/HIGH ones and any secret before finishing; the Stop hook will block on them.',
      },
    }),
  );
}

main();
