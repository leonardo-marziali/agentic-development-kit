#!/usr/bin/env node
'use strict';

/*
 * Stop / SubagentStop hook: checks only the Python files this session
 * touched (per track-touched.js) with ruff and pyright, auto-fixes what ruff
 * can, and if findings remain, blocks the stop with `decision: "block"`
 * so Claude keeps fixing them. Both tools share one loop — one attempt
 * counter, one message — so a session isn't bounced between two separate
 * blocking hooks.
 *
 * Inside a git repository only findings on lines that differ from the
 * session base (ad-lfl-kit's scope.js, ±2 lines) block; the rest are
 * reported once on stderr and left alone. `ruff check --fix` rewrites whole
 * files, so a file that also has findings on unchanged lines is not
 * auto-fixed; formatting writes only ruff's changes near the changed lines;
 * and auto-suppression only ever comments changed lines. Outside a
 * repository, for an untracked file, or with the plugin's `whole_files`
 * option on, whole files are checked, fixed and formatted as before.
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
  loopStateDir,
  readTrackedFiles,
  trackSessionChanges,
  runFixLoop,
  scopesFor,
  partitionByScope,
  fixableFiles,
  readSessionBases,
  SESSION_BASE_FILE,
} = require('@leonardo-marziali/ad-lfl-kit');
const {
  STATE_NAMESPACE,
  TOUCHED_FILES,
  isPythonFile,
  isIgnoredPath,
  resolveTool,
  runResolved,
  groupByConfigDir,
  pythonPathFor,
  parsePyrightJson,
  formatPyrightReport,
  parseRuffJson,
  formatRuffReport,
  autoSuppressEnabled,
  wholeFilesEnabled,
  insertPyrightIgnores,
  insertNoqa,
  formatWithRuff,
} = require('./lib');

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
  const result = runResolved(resolved, args, { cwd: dir, encoding: 'utf8' });
  if (result.error) {
    warnOnce(`${tool} invocation failed: ${result.error.message}`);
    return null;
  }
  return result;
}

function output(result) {
  return ((result.stdout || '') + (result.stderr || '')).trim();
}

/*
 * Fixes, then formats, `fixable` (absolute paths) per group: fixes can
 * leave code unformatted. Formatting is scoped like everything else here.
 */
function ruffFix(groups, fixable, bases) {
  for (const [dir, groupFiles] of groups) {
    const files = groupFiles.filter((file) => fixable.has(path.resolve(file)));
    if (files.length === 0) continue;
    runTool('ruff', dir, ['check', '--fix', '--force-exclude', ...files]);
    const ruff = resolveTool('ruff', { fromDir: dir });
    if (!ruff) continue;
    for (const file of files) {
      const result = formatWithRuff(ruff, path.resolve(file), {
        bases,
        wholeFile: wholeFilesEnabled(),
      });
      if (!result.ok) warnOnce(`formatting ${file} failed:\n${result.output}`);
    }
  }
}

// Ruff exits 0 when clean, 1 on findings, 2 on anything else.
function ruffFindings(groups) {
  const findings = [];
  for (const [dir, groupFiles] of groups) {
    const result = runTool('ruff', dir, [
      'check',
      '--force-exclude',
      '--output-format=json',
      ...groupFiles,
    ]);
    if (!result || result.status === 0) continue;
    const parsed = result.status === 1 ? parseRuffJson(result.stdout) : null;
    if (parsed) {
      findings.push(...parsed);
    } else {
      warnOnce(`ruff check failed in ${dir}; skipping it:\n${output(result)}`);
    }
  }
  return findings;
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

/*
 * Both tools' findings, tagged so one partition can scope them together:
 * `file` and a 1-based `line` (pyright's JSON lines are 0-based).
 */
function collectFindings(groups) {
  return [
    ...ruffFindings(groups).map((raw) => ({
      tool: 'ruff',
      file: raw.filename,
      line: raw.location.row,
      raw,
    })),
    ...pyrightDiagnostics(groups).map((raw) => ({
      tool: 'pyright',
      file: raw.file,
      line: raw.range.start.line + 1,
      raw,
    })),
  ];
}

const rawOf = (findings, tool) => findings.filter((f) => f.tool === tool).map((f) => f.raw);

function describe(findings) {
  return [
    formatRuffReport(rawOf(findings, 'ruff')),
    formatPyrightReport(rawOf(findings, 'pyright')),
  ]
    .filter(Boolean)
    .join('\n');
}

/*
 * Checks every group and splits the findings into the ones this session is
 * answerable for and the ones already there. With `whole_files` on,
 * everything is. `outOfScopeRuffFiles` — files with pre-existing ruff
 * findings — is what decides whether ruff's whole-file `--fix` and
 * `--add-noqa` are safe; a pyright finding elsewhere doesn't matter to them.
 */
function analyze(groups, files, { bases, notes }) {
  const findings = collectFindings(groups);
  if (wholeFilesEnabled()) {
    return { inScope: findings, outOfScopeRuffFiles: new Set() };
  }

  const scoped = partitionByScope(findings, { scopes: scopesFor(files, { bases }) });
  if (scoped.outOfScope.length > 0) {
    notes.add(
      `${scoped.outOfScope.length} pre-existing ruff/pyright finding(s) on lines this ` +
        `session did not change were not blocked on:\n${describe(scoped.outOfScope)}`,
    );
  }
  const outOfScopeRuffFiles = new Set(
    scoped.outOfScope.filter((f) => f.tool === 'ruff').map((f) => path.resolve(f.file)),
  );
  return { ...scoped, outOfScopeRuffFiles };
}

function toOutcome({ inScope }) {
  const sections = [];
  const ruffReport = formatRuffReport(rawOf(inScope, 'ruff'));
  const pyrightReport = formatPyrightReport(rawOf(inScope, 'pyright'));
  if (ruffReport) sections.push(`## ruff\n\n${ruffReport}`);
  if (pyrightReport) sections.push(`## pyright\n\n${pyrightReport}`);
  return { failed: sections.length > 0, report: sections.join('\n\n') };
}

/*
 * Ruff's in-scope findings at the cap. A file with nothing of ruff's out of
 * scope gets ruff's own `--add-noqa`, which knows every edge case; one that
 * also has pre-existing findings gets line-scoped comments from insertNoqa,
 * since `--add-noqa` would silence those too.
 */
function suppressRuff(groups, scoped) {
  const inScopeRuff = rawOf(scoped.inScope, 'ruff');
  const byAddNoqa = new Set();
  for (const finding of inScopeRuff) {
    const file = path.resolve(finding.filename);
    if (!scoped.outOfScopeRuffFiles.has(file)) byAddNoqa.add(file);
  }
  for (const [dir, groupFiles] of groups) {
    const files = groupFiles.filter((file) => byAddNoqa.has(path.resolve(file)));
    if (files.length > 0)
      runTool('ruff', dir, ['check', '--add-noqa', '--force-exclude', ...files]);
  }
  insertNoqa(inScopeRuff.filter((finding) => !byAddNoqa.has(path.resolve(finding.filename))));
}

/*
 * runFixLoop's onCap: attempts have run out, so the stop is going through
 * regardless. Report what's left, and — only when the user opted in via
 * auto_suppress — suppress it inline so the next session starts clean.
 * Only in-scope findings are suppressed: pre-existing ones on lines this
 * session didn't change are not its to silence.
 */
function giveUp(groups, analyzeNow, { outcome, maxAttempts }) {
  if (!autoSuppressEnabled()) {
    process.stderr.write(
      `python plugin: ruff/pyright findings remain after ${maxAttempts} fix attempts; ` +
        "leaving them in place. Enable this plugin's `auto_suppress` option to have inline " +
        '`# noqa` / `# pyright: ignore` comments written for whatever is still failing at the cap.\n' +
        `${outcome.report}\n`,
    );
    return;
  }

  /*
   * Pyright first: its ignore comment is appended at the end of the line,
   * and the noqa comment then goes after it without moving anything pyright
   * pointed at.
   */
  const scoped = analyzeNow();
  const suppressed = insertPyrightIgnores(rawOf(scoped.inScope, 'pyright'));
  suppressRuff(groups, analyzeNow());
  const remaining = toOutcome(analyzeNow());

  process.stderr.write(
    `python plugin: findings remained after ${maxAttempts} fix attempts; auto-suppressed ` +
      'them inline instead of looping forever:\n' +
      suppressed
        .map((s) => `  ${s.file}:${s.lineNumber} — pyright: ${s.rules.join(', ')}`)
        .join('\n') +
      (suppressed.length > 0 ? '\n' : '') +
      '  ruff findings: suppressed with `# noqa` comments\n' +
      (remaining.failed
        ? `Still unresolved (no rule to suppress, e.g. syntax errors):\n${remaining.report}\n`
        : ''),
  );
}

const GUIDANCE = [
  'Ruff auto-fixes and formatting were already applied where that was safe. Fix the remaining',
  "ones directly, respecting the project's ruff config (pyproject.toml / ruff.toml) and pyright",
  'config (pyrightconfig.json / [tool.pyright]). If fixing one properly would mean writing',
  'incorrect code (e.g. a type error caused by an untyped third-party library), suppress',
  'that specific finding inline instead of forcing a fix: `# noqa: <CODE>` for ruff,',
  '`# pyright: ignore[<rule>]` for pyright.',
].join(' ');

const SCOPE_GUIDANCE = [
  'Only findings on lines this session changed are listed; fix just those. A file that also',
  'has findings on unchanged lines was not auto-fixed, so its fixable ones are listed too.',
].join(' ');

// What happens once the attempts run out, per the auto_suppress option.
function capNotice(maxAttempts) {
  return autoSuppressEnabled()
    ? `Whatever is still unresolved after attempt ${maxAttempts} gets suppressed that way automatically.`
    : `After attempt ${maxAttempts} the loop stops and reports whatever is left.`;
}

function buildMessage({ attempt, maxAttempts, outcome }) {
  const heading = `ruff/pyright found unresolved issues in Python files edited this session (attempt ${attempt}/${maxAttempts}):`;
  const guidance = wholeFilesEnabled() ? GUIDANCE : `${GUIDANCE} ${SCOPE_GUIDANCE}`;
  return {
    stopReason: 'Python files touched in this session still have ruff or pyright findings.',
    systemMessage: [heading, outcome.report, `${guidance} ${capNotice(maxAttempts)}`].join('\n\n'),
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
    matches: (absPath) => isPythonFile(absPath) && !isIgnoredPath(absPath),
  });

  /*
   * A session that never touched a Python file has no list: no files, no-op.
   * A SubagentStop checks only what that subagent touched; the main Stop
   * checks everything, subagents' files included.
   */
  const dir = loopStateDir({ dir: sessionDir, input });
  const files = readTrackedFiles(path.join(dir, TOUCHED_FILES)).filter(isPythonFile);
  const groups = groupByConfigDir(files);
  // Diff against the session base, so lines already committed stay in scope.
  const ctx = { bases: readSessionBases(sessionDir), notes: new Set() };
  const analyzeNow = () => analyze(groups, files, ctx);

  // Set when nothing was fixed, so `check` needn't run both tools again.
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
      const scoped = analyzeNow();
      const withRuffFindings = [
        ...new Set(rawOf(scoped.inScope, 'ruff').map((f) => path.resolve(f.filename))),
      ];
      // Only ruff's own pre-existing findings are at risk from `ruff check --fix`.
      const fixable = new Set(
        fixableFiles({ files: withRuffFindings, outOfScopeFiles: scoped.outOfScopeRuffFiles }),
      );
      if (fixable.size === 0) {
        current = scoped;
        return;
      }
      ruffFix(groups, fixable, ctx.bases);
    },
    check: () => {
      current = current || analyzeNow();
      return toOutcome(current);
    },
    onCap: (cap) => giveUp(groups, analyzeNow, cap),
    buildMessage,
  });

  for (const note of ctx.notes) process.stderr.write(`python plugin: ${note}\n`);
  if (result.reason === 'error') {
    process.stderr.write(`python plugin: check invocation failed: ${result.error.message}\n`);
  }
}

main();
