'use strict';

/*
 * Output for an LLM reader: compact, sorted worst-first, and never a line per
 * clean file. Clean files collapse into a count — listing them would spend
 * the reader's attention on the part of the result that needs none.
 */

const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { rank, normalize } = require('./severity');

/*
 * One SLOOP issue (either the rawIssues or the RaisedIssueDto shape) into the
 * flat record the CLI prints. `displayPath` decides how `file` reads.
 */
function toRecord(issue, displayPath) {
  const { severity, type } = normalize(issue);
  const range = issue.textRange || {};
  const uri = issue.fileUri || issue.uri;
  const abs = uri ? fileURLToPath(uri) : issue.file;
  return {
    file: displayPath(abs),
    line: range.startLine ?? null,
    endLine: range.endLine ?? range.startLine ?? null,
    rule: issue.ruleKey,
    severity,
    type,
    message: issue.primaryMessage,
    hasQuickFix: Array.isArray(issue.quickFixes) && issue.quickFixes.length > 0,
  };
}

function compareRecords(a, b) {
  return (
    rank(b.severity) - rank(a.severity) ||
    a.file.localeCompare(b.file) ||
    (a.line ?? 0) - (b.line ?? 0) ||
    a.rule.localeCompare(b.rule)
  );
}

/*
 * Paths read relative to the caller's cwd when they are inside it — shorter,
 * and what the reader typed — and absolute otherwise.
 */
function displayPathFrom(cwd) {
  return (abs) => {
    const rel = path.relative(cwd, abs);
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
      ? rel.split(path.sep).join('/')
      : abs;
  };
}

/*
 * Builds the result object both formats render from.
 *   analyzed — absolute paths SLOOP was asked to analyze
 *   skipped  — [{ file, reason }] that never reached SLOOP
 */
function buildResult({ issues, analyzed, skipped = [], failed = [], minSeverity, cwd }) {
  const displayPath = displayPathFrom(cwd);
  const records = issues.map((issue) => toRecord(issue, displayPath)).sort(compareRecords);
  const withIssues = new Set(records.map((r) => r.file));
  const threshold = rank(minSeverity);
  return {
    issues: records,
    summary: {
      analyzed: analyzed.length,
      clean: analyzed.map(displayPath).filter((f) => !withIssues.has(f)).length,
      withIssues: withIssues.size,
      atOrAboveThreshold: records.filter((r) => rank(r.severity) >= threshold).length,
      minSeverity,
    },
    skipped: skipped.map((s) => ({ file: displayPath(s.file), reason: s.reason })),
    failed: failed.map(displayPath),
  };
}

function renderText(result) {
  const lines = result.issues.map((r) => {
    const where = r.line ? `${r.file}:${r.line}` : r.file;
    const fix = r.hasQuickFix ? ' (quick fix available)' : '';
    return `${where}  ${r.severity}  ${r.rule}  ${r.message}${fix}`;
  });
  const s = result.summary;
  const parts = [`${s.analyzed} file(s) analyzed`, `${s.clean} clean`];
  if (s.withIssues) parts.push(`${result.issues.length} issue(s) in ${s.withIssues} file(s)`);
  parts.push(`${s.atOrAboveThreshold} at/above ${s.minSeverity}`);
  lines.push(parts.join(', '));
  for (const skip of result.skipped) lines.push(`skipped ${skip.file}: ${skip.reason}`);
  for (const file of result.failed) lines.push(`analysis failed for ${file}`);
  return `${lines.join('\n')}\n`;
}

function render(result, format) {
  return format === 'json' ? `${JSON.stringify(result)}\n` : renderText(result);
}

function exitCodeFor(result) {
  return result.summary.atOrAboveThreshold > 0 ? 1 : 0;
}

module.exports = {
  toRecord,
  compareRecords,
  displayPathFrom,
  buildResult,
  renderText,
  render,
  exitCodeFor,
};
