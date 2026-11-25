'use strict';

/*
 * The ruff and pyright analysis and the ruff fix step behind the Stop hook
 * (check-and-loop.js) and the standalone changed-lines CLI
 * (scripts/check-changes.js), kept here so both reach the same verdict on
 * the same lines. Nothing here reads hook input or session state: callers
 * pass the files, the bases that decide which lines count as changed, and
 * `warn(message, { failed })` — `failed` set when a tool could not run, so
 * its files went unchecked.
 *
 * Only pyright *errors* count; warnings and information never block.
 *
 * Pyright reads exactly one config per run, so files are grouped by their
 * nearest pyrightconfig.json / pyproject.toml (see lib.js) and each group is
 * checked with `-p` pointed there. Ruff resolves config per file itself, but
 * runs per group too, so each group uses the ruff from its own `.venv`.
 */

const path = require('node:path');
const { scopesFor, partitionByScope, fixableFiles } = require('@leonardo-marziali/ad-lfl-kit');
const {
  resolveTool,
  runResolved,
  pythonPathFor,
  parsePyrightJson,
  formatPyrightReport,
  parseRuffJson,
  formatRuffReport,
  wholeFilesEnabled,
  formatWithRuff,
} = require('./lib');

function runTool(tool, dir, args, warn) {
  const resolved = resolveTool(tool, { fromDir: dir });
  if (!resolved) {
    warn(`${tool} not found (no .venv, PATH or ${tool === 'ruff' ? 'uvx' : 'npx'}); skipping it.`, {
      failed: true,
    });
    return null;
  }
  const result = runResolved(resolved, args, { cwd: dir, encoding: 'utf8' });
  if (result.error) {
    warn(`${tool} invocation failed: ${result.error.message}`, { failed: true });
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
function ruffFix(groups, fixable, { bases, warn }) {
  for (const [dir, groupFiles] of groups) {
    const files = groupFiles.filter((file) => fixable.has(path.resolve(file)));
    if (files.length === 0) continue;
    runTool('ruff', dir, ['check', '--fix', '--force-exclude', ...files], warn);
    const ruff = resolveTool('ruff', { fromDir: dir });
    if (!ruff) continue;
    for (const file of files) {
      const result = formatWithRuff(ruff, path.resolve(file), {
        bases,
        wholeFile: wholeFilesEnabled(),
      });
      if (!result.ok) warn(`formatting ${file} failed:\n${result.output}`);
    }
  }
}

// Ruff exits 0 when clean, 1 on findings, 2 on anything else.
function ruffFindings(groups, warn) {
  const findings = [];
  for (const [dir, groupFiles] of groups) {
    const result = runTool(
      'ruff',
      dir,
      ['check', '--force-exclude', '--output-format=json', ...groupFiles],
      warn,
    );
    if (!result || result.status === 0) continue;
    const parsed = result.status === 1 ? parseRuffJson(result.stdout) : null;
    if (parsed) {
      findings.push(...parsed);
    } else {
      warn(`ruff check failed in ${dir}; skipping it:\n${output(result)}`, { failed: true });
    }
  }
  return findings;
}

// Pyright exits 0 when clean, 1 on errors, 2+ on fatal/config/CLI errors.
function pyrightDiagnostics(groups, warn) {
  const diags = [];
  for (const [dir, groupFiles] of groups) {
    const args = ['--outputjson', '-p', dir];
    const python = pythonPathFor(dir);
    if (python) args.push('--pythonpath', python);
    const result = runTool('pyright', dir, [...args, ...groupFiles], warn);
    if (!result || result.status === 0) continue;
    const parsed = result.status === 1 ? parsePyrightJson(result.stdout) : null;
    if (parsed) {
      diags.push(...parsed);
    } else {
      warn(`pyright failed in ${dir}; skipping it:\n${output(result)}`, { failed: true });
    }
  }
  return diags;
}

/*
 * Both tools' findings, tagged so one partition can scope them together:
 * `file` and a 1-based `line` (pyright's JSON lines are 0-based).
 */
function collectFindings(groups, warn) {
  return [
    ...ruffFindings(groups, warn).map((raw) => ({
      tool: 'ruff',
      file: raw.filename,
      line: raw.location.row,
      raw,
    })),
    ...pyrightDiagnostics(groups, warn).map((raw) => ({
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
function analyze(groups, files, { bases, notes, warn }) {
  const findings = collectFindings(groups, warn);
  if (wholeFilesEnabled()) {
    return { inScope: findings, outOfScope: [], outOfScopeRuffFiles: new Set() };
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
 * The files `ruff check --fix` may rewrite: those with an in-scope ruff
 * finding and no ruff finding out of scope. Only ruff's own pre-existing
 * findings are at risk from a whole-file `--fix`.
 */
function fixTargets(scoped) {
  const withRuffFindings = [
    ...new Set(rawOf(scoped.inScope, 'ruff').map((f) => path.resolve(f.filename))),
  ];
  return new Set(
    fixableFiles({ files: withRuffFindings, outOfScopeFiles: scoped.outOfScopeRuffFiles }),
  );
}

// One finding in the CLI's tool-neutral shape.
function toFinding({ tool, file, line, raw }) {
  return tool === 'ruff'
    ? {
        file: path.resolve(file),
        line,
        rule: raw.code || 'ruff',
        message: raw.message,
        severity: 'error',
      }
    : {
        file: path.resolve(file),
        line,
        rule: raw.rule || 'pyright',
        message: raw.message,
        severity: raw.severity,
      };
}

module.exports = {
  runTool,
  ruffFix,
  rawOf,
  analyze,
  fixTargets,
  toOutcome,
  toFinding,
};
