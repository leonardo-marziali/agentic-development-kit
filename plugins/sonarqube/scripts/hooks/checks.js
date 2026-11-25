'use strict';

/*
 * The local SonarQube for IDE analysis and its blocking policy, behind the
 * Stop hook (check-and-loop.js) and the standalone changed-lines CLI
 * (scripts/check-changes.js), kept here so both reach the same verdict on
 * the same lines. Nothing here reads hook input or session state: callers
 * pass the files and the bases that decide which lines count as changed.
 *
 * What blocks: any secret, wherever it is in a file, and issues at or above
 * `min_blocking_severity` (default HIGH) on changed lines (±2). The data
 * dir reaches the `sonarlint` CLI through CLAUDE_PLUGIN_DATA, which both
 * callers' processes inherit (see cli/paths.js).
 */

const path = require('node:path');
const { scopesFor, partitionByScope } = require('@leonardo-marziali/ad-lfl-kit');
const { blockingPolicy, blocks, isSecret, runSonarlint, parseAnalysis } = require('./lib');
const { groupByBinding, describeGroup } = require('./connected-mode');

/*
 * The hook runs under a 180s timeout. A cold daemon needs ~20-30s before the
 * first analysis completes, so the CLI gets 150s and the rest is margin.
 */
const ANALYSIS_TIMEOUT_S = 150;

class ToolFailure extends Error {}

function formatIssue(issue) {
  const where = issue.line ? `${issue.relFile}:${issue.line}` : issue.relFile;
  const fix = issue.hasQuickFix ? ' (quick fix available)' : '';
  return `- ${where} ${issue.severity} ${issue.rule}: ${issue.message}${fix}`;
}

/*
 * One section per connected-mode binding, so a monorepo's findings say which
 * SonarQube project they belong to — the key Claude needs if it goes on to
 * look the project up with `sonar api`.
 */
function sections(issues, cwd) {
  const groups = groupByBinding([...new Set(issues.map((i) => i.abs))], { fallbackDir: cwd });
  return groups
    .map((group) => {
      const inGroup = new Set(group.files);
      const lines = issues.filter((i) => inGroup.has(i.abs)).map(formatIssue);
      return `## ${describeGroup(group)}\n\n${lines.join('\n')}`;
    })
    .join('\n\n');
}

/*
 * runFixLoop's check: returns { failed, report, blocking, outOfScope }, or
 * throws ToolFailure when the analysis could not run at all (runFixLoop then
 * neither blocks nor discards state).
 */
function analyze(files, { cwd, notes, bases }) {
  const run = runSonarlint(
    [
      'files',
      ...files,
      '--format',
      'json',
      '--min-severity',
      'INFO',
      '--timeout',
      String(ANALYSIS_TIMEOUT_S),
    ],
    { cwd, timeoutMs: (ANALYSIS_TIMEOUT_S + 20) * 1000 },
  );
  const parsed = parseAnalysis(run);
  if (!parsed.ok) throw new ToolFailure(parsed.reason);

  const { result } = parsed;
  for (const skip of result.skipped || []) notes.add(`skipped ${skip.file}: ${skip.reason}`);
  for (const analyzer of result.skippedAnalyzers || []) {
    notes.add(
      `the ${analyzer.language} analyzer could not load (${analyzer.reason}); those files were not checked.`,
    );
  }

  const policy = blockingPolicy();
  const issues = result.issues.map((issue) => ({
    ...issue,
    abs: path.resolve(cwd, issue.file),
    relFile: issue.file,
  }));
  const candidates = issues.filter((issue) => blocks(issue, policy));
  const secrets = candidates.filter(isSecret);
  const scoped = partitionByScope(
    candidates.filter((issue) => !isSecret(issue)),
    { scopes: scopesFor(files, { bases }), getFile: (i) => i.abs, getLine: (i) => i.line },
  );

  if (scoped.outOfScope.length) {
    notes.add(
      `${scoped.outOfScope.length} pre-existing finding(s) at/above ${policy.threshold} on lines this ` +
        'session did not change were not blocked on:\n' +
        scoped.outOfScope.map(formatIssue).join('\n'),
    );
  }

  const blocking = [...secrets, ...scoped.inScope];
  return {
    failed: blocking.length > 0,
    report: sections(blocking, cwd),
    blocking,
    outOfScope: scoped.outOfScope,
  };
}

module.exports = { ToolFailure, ANALYSIS_TIMEOUT_S, formatIssue, analyze };
