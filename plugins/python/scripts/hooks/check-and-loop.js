#!/usr/bin/env node
'use strict';

/*
 * Stop / SubagentStop hook: checks only the Python files this session
 * touched (per track-touched.js) with ruff and pyright, auto-fixes what ruff
 * can, and if findings remain, blocks the stop with `decision: "continue"`
 * so Claude keeps fixing them. Both tools share one loop — one attempt
 * counter, one message — so a session isn't bounced between two separate
 * blocking hooks.
 *
 * The loop itself — attempt counting, the cap, the blocking payload, and
 * removing only this hook's own state files — is ad-lfl-kit's runFixLoop.
 * What happens at the cap depends on the plugin's `auto_suppress` user
 * config: off (the default) just reports what's still failing and stops
 * blocking; on writes `# pyright: ignore[...]` and `# noqa: ...` comments
 * for the remainder. Editing a user's files to silence a checker is a
 * surprising thing to do unasked, so it's opt-in rather than the default.
 *
 * Only pyright *errors* count; warnings and information never block. A tool
 * that can't be found, or that fails for a reason other than findings (a
 * broken config, a bad flag), is reported on stderr and skipped: a broken
 * toolchain must not trap the session in a loop.
 *
 * Pyright reads exactly one config per run, so files are grouped by their
 * nearest pyrightconfig.json / pyproject.toml (see lib.js) and each group is
 * checked with `-p` pointed there. Ruff resolves config per file itself, but
 * runs per group too, so each group uses the ruff from its own `.venv`.
 */

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
  isPythonFile,
  resolveTool,
  groupByConfigDir,
  pythonPathFor,
  parsePyrightJson,
  formatPyrightReport,
  autoSuppressEnabled,
  insertPyrightIgnores,
} = require('./lib');

/*
 * The state directory is keyed by session id and may be shared with other
 * hooks, so cleanup removes only these files and then drops the directory
 * only if that leaves it empty.
 */
const OWN_STATE_FILES = [TOUCHED_FILES, 'attempts.json'];

const warned = new Set();
function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  process.stderr.write(`python plugin: ${message}\n`);
}

function runTool(tool, dir, args) {
  const resolved = resolveTool(tool, { fromDir: dir });
  if (!resolved) {
    warnOnce(
      `${tool} not found (no .venv, PATH or ${tool === 'ruff' ? 'uvx' : 'npx'}); skipping it.`,
    );
    return null;
  }
  const result = runBin(resolved.name, [...resolved.prefix, ...args], {
    cwd: dir,
    encoding: 'utf8',
    extraDirs: resolved.extraDirs,
  });
  if (result.error) {
    warnOnce(`${tool} invocation failed: ${result.error.message}`);
    return null;
  }
  return result;
}

function output(result) {
  return ((result.stdout || '') + (result.stderr || '')).trim();
}

function ruffFix(groups) {
  for (const [dir, groupFiles] of groups) {
    // Fixes can leave code unformatted, so format after fixing.
    runTool('ruff', dir, ['check', '--fix', '--force-exclude', ...groupFiles]);
    runTool('ruff', dir, ['format', '--force-exclude', ...groupFiles]);
  }
}

// Ruff exits 0 when clean, 1 on findings, 2 on anything else.
function ruffCheck(groups) {
  let report = '';
  for (const [dir, groupFiles] of groups) {
    const result = runTool('ruff', dir, [
      'check',
      '--force-exclude',
      '--output-format=concise',
      ...groupFiles,
    ]);
    if (!result || result.status === 0) continue;
    if (result.status === 1) {
      report += `${output(result)}\n`;
    } else {
      warnOnce(`ruff check failed in ${dir}; skipping it:\n${output(result)}`);
    }
  }
  return report.trim();
}

// Pyright exits 0 when clean, 1 on errors, 2+ on fatal/config/CLI errors.
function pyrightDiagnostics(groups) {
  const diags = [];
  for (const [dir, groupFiles] of groups) {
    const args = ['--outputjson', '-p', dir];
    const python = pythonPathFor(dir);
    if (python) args.push('--pythonpath', python);
    const result = runTool('pyright', dir, [...args, ...groupFiles]);
    if (!result || result.status === 0) continue;
    const parsed = result.status === 1 ? parsePyrightJson(result.stdout) : null;
    if (parsed) {
      diags.push(...parsed);
    } else {
      warnOnce(`pyright failed in ${dir}; skipping it:\n${output(result)}`);
    }
  }
  return diags;
}

function check(groups) {
  const ruffReport = ruffCheck(groups);
  const pyrightReport = formatPyrightReport(pyrightDiagnostics(groups));

  const sections = [];
  if (ruffReport) sections.push(`## ruff\n\n${ruffReport}`);
  if (pyrightReport) sections.push(`## pyright\n\n${pyrightReport}`);
  return { failed: sections.length > 0, report: sections.join('\n\n') };
}

/*
 * runFixLoop's onCap: attempts have run out, so the stop is going through
 * regardless. Report what's left, and — only when the user opted in via
 * auto_suppress — suppress it inline so the next session starts clean.
 */
function giveUp(groups, { outcome, maxAttempts }) {
  if (!autoSuppressEnabled()) {
    process.stderr.write(
      `python plugin: ruff/pyright findings remain after ${maxAttempts} fix attempts; ` +
        'leaving them in place. Enable this plugin\'s "auto_suppress" option to have inline ' +
        '`# noqa` / `# pyright: ignore` comments written for whatever is still failing at the cap.\n' +
        `${outcome.report}\n`,
    );
    return;
  }

  /*
   * Pyright first: its ignore comment is appended at the end of the line,
   * and ruff's --add-noqa then merges its own code into the line's comment
   * without moving anything pyright pointed at.
   */
  const suppressed = insertPyrightIgnores(pyrightDiagnostics(groups));
  for (const [dir, groupFiles] of groups) {
    runTool('ruff', dir, ['check', '--add-noqa', '--force-exclude', ...groupFiles]);
  }
  const remaining = check(groups);

  process.stderr.write(
    `python plugin: findings remained after ${maxAttempts} fix attempts; auto-suppressed ` +
      'them inline instead of looping forever:\n' +
      suppressed
        .map((s) => `  ${s.file}:${s.lineNumber} — pyright: ${s.rules.join(', ')}`)
        .join('\n') +
      (suppressed.length > 0 ? '\n' : '') +
      '  ruff findings: suppressed with `# noqa` via `ruff check --add-noqa`\n' +
      (remaining.failed
        ? `Still unresolved (no rule to suppress, e.g. syntax errors):\n${remaining.report}\n`
        : ''),
  );
}

const GUIDANCE = [
  'Ruff auto-fixes and formatting were already applied. Fix the remaining ones directly,',
  "respecting the project's ruff config (pyproject.toml / ruff.toml) and pyright config",
  '(pyrightconfig.json / [tool.pyright]). If fixing one properly would mean writing',
  'incorrect code (e.g. a type error caused by an untyped third-party library), suppress',
  'that specific finding inline instead of forcing a fix: `# noqa: <CODE>` for ruff,',
  '`# pyright: ignore[<rule>]` for pyright.',
].join(' ');

// What happens once the attempts run out, per the auto_suppress option.
function capNotice(maxAttempts) {
  return autoSuppressEnabled()
    ? `Whatever is still unresolved after attempt ${maxAttempts} gets suppressed that way automatically.`
    : `After attempt ${maxAttempts} the loop stops and reports whatever is left.`;
}

function buildMessage({ attempt, maxAttempts, outcome }) {
  const heading = `ruff/pyright found unresolved issues in Python files edited this session (attempt ${attempt}/${maxAttempts}):`;
  return {
    stopReason: 'Python files touched in this session still have ruff or pyright findings.',
    systemMessage: [heading, outcome.report, `${GUIDANCE} ${capNotice(maxAttempts)}`].join('\n\n'),
  };
}

function main() {
  const input = readHookInput();
  if (!input) return;

  // A session that never touched a Python file has no list: no files, no-op.
  const dir = stateDir({ sessionId: input.session_id, namespace: STATE_NAMESPACE });
  const files = readTrackedFiles(path.join(dir, TOUCHED_FILES)).filter(isPythonFile);
  const groups = groupByConfigDir(files);

  const result = runFixLoop({
    input,
    dir,
    stateFiles: OWN_STATE_FILES,
    files,
    fix: () => ruffFix(groups),
    check: () => check(groups),
    onCap: (cap) => giveUp(groups, cap),
    buildMessage,
  });

  if (result.reason === 'error') {
    process.stderr.write(`python plugin: check invocation failed: ${result.error.message}\n`);
  }
}

main();
