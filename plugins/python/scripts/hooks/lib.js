'use strict';

/*
 * The Python-specific half of this plugin's hooks. The generic loop
 * machinery — hook input, session state, file tracking, the capped fix loop,
 * spawning CLI shims — comes from @leonardo-marziali/ad-lfl-kit.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runBin, formatInScope, changedRangesByFile } = require('@leonardo-marziali/ad-lfl-kit');

/*
 * track-touched.js writes the list and check-and-loop.js reads it, so both
 * hooks must agree on where this session's state lives.
 */
const STATE_NAMESPACE = 'python-session-scope';
const TOUCHED_FILES = 'touched-files.txt';

function isPythonFile(filePath) {
  return /\.pyi?$/i.test(filePath);
}

/*
Virtualenvs, caches and vendored trees are never the session's own source,
even when a tool call happens to write into one.
*/
const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.venv',
  'venv',
  '__pycache__',
  'site-packages',
]);

function isIgnoredPath(absPath) {
  return path
    .dirname(path.resolve(absPath))
    .split(path.sep)
    .some((segment) => IGNORED_DIR_NAMES.has(segment));
}

function venvBinDir(venv) {
  return path.join(venv, process.platform === 'win32' ? 'Scripts' : 'bin');
}

/*
Visits `fromDir` and each of its ancestors up to the filesystem root, and
returns the first non-null result of `pick(dir)`, or null.
*/
function findUp(fromDir, pick) {
  for (let dir = path.resolve(fromDir); ; dir = path.dirname(dir)) {
    const found = pick(dir);
    if (found !== null) return found;
    if (path.dirname(dir) === dir) return null;
  }
}

// The bin dir of the nearest `.venv` at or above `fromDir`.
function findVenvBinDir(fromDir) {
  return findUp(fromDir, (dir) => {
    const bin = venvBinDir(path.join(dir, '.venv'));
    return fs.existsSync(bin) ? bin : null;
  });
}

function executableNames(name) {
  if (process.platform !== 'win32') return [name];
  const exts = (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean);
  return exts.map((ext) => name + ext.toLowerCase());
}

// The full path of `name` (with its Windows extension) in `dir`, or null.
function findExecutable(dir, name) {
  for (const candidate of executableNames(name)) {
    const full = path.join(dir, candidate);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      if (fs.statSync(full).isFile()) return full;
    } catch {
      // Not there, or not executable: try the next candidate.
    }
  }
  return null;
}

function hasExecutable(dir, name) {
  return findExecutable(dir, name) !== null;
}

function onPath(name) {
  return (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) => hasExecutable(dir, name));
}

/*
How each tool is reached when it's neither in the project's venv nor on
PATH: ruff isn't published to npm, so it goes through uv; pyright is an npm
package, so npx can fetch it like the markdown plugin fetches markdownlint.
*/
const FALLBACKS = {
  ruff: { name: 'uvx', prefix: ['ruff'] },
  pyright: { name: 'npx', prefix: ['-y', 'pyright'] },
};

/*
Resolves a tool in the order the project would expect: its own `.venv`
first (so a pinned version wins), then PATH, then the tool's fallback
runner. Returns { name, prefix, extraDirs } for runBin — plus `exe`, the
exact executable, for a venv tool — or null when nothing can run it;
callers fail open in that case rather than block. Run the result with
runResolved.

The PATH search is done by hand because runBin's own resolution falls
back to the bare name without knowing whether it exists, and the fallback
runner should only be reached when it doesn't.
*/
function resolveTool(tool, { fromDir } = {}) {
  const venvBin = fromDir ? findVenvBinDir(fromDir) : null;
  const venvExe = venvBin ? findExecutable(venvBin, tool) : null;
  if (venvExe) return { name: tool, prefix: [], extraDirs: [venvBin], exe: venvExe };
  if (onPath(tool)) return { name: tool, prefix: [], extraDirs: [] };

  const fallback = FALLBACKS[tool];
  if (fallback && (onPath(fallback.name) || fallback.name === 'npx')) {
    /*
    npx always resolves: it ships beside the node binary running this
    hook, which is where runBin looks first.
    */
    return { name: fallback.name, prefix: fallback.prefix, extraDirs: [] };
  }
  return null;
}

/*
Runs a tool resolveTool found. A venv tool is spawned by its exact path:
runBin looks beside the node binary before its `extraDirs`, so wherever a
system ruff or pyright is installed next to node, passing the venv only as
an extra dir would run that one instead of the project's pinned version.
*/
function runResolved(resolved, args, options = {}) {
  if (resolved.exe) return spawnSync(resolved.exe, args, options);
  return runBin(resolved.name, [...resolved.prefix, ...args], {
    ...options,
    extraDirs: resolved.extraDirs,
  });
}

const CONFIG_NAMES = ['pyrightconfig.json', 'pyproject.toml'];

/*
Ruff resolves its config per file on its own, but pyright reads exactly
one config per run. To respect the nearest config to each file (including
in a monorepo), files are grouped by their nearest config directory and
pyright runs once per group with `-p` pointed there.
*/
function resolveConfigDir(filePath) {
  const fileDir = path.dirname(path.resolve(filePath));
  const hasConfig = (dir) => CONFIG_NAMES.some((name) => fs.existsSync(path.join(dir, name)));
  // No config anywhere above the file: use the file's own directory.
  return findUp(fileDir, (dir) => (hasConfig(dir) ? dir : null)) ?? fileDir;
}

function groupByConfigDir(files) {
  return Map.groupBy(files, resolveConfigDir);
}

/*
The project's own interpreter, so pyright resolves the project's installed
packages instead of flagging every third-party import. Skipped when the
config already names a venv: that's the project's explicit choice, and
--pythonpath on the command line would override it.
*/
function pythonPathFor(configDir) {
  for (const name of CONFIG_NAMES) {
    const configFile = path.join(configDir, name);
    if (!fs.existsSync(configFile)) continue;
    // A `venv` key at the start of a line: TOML `venv =` or JSON `"venv":`.
    if (/^[ \t]*"?venv"?[ \t]*[:=]/m.test(fs.readFileSync(configFile, 'utf8'))) return null;
  }
  const python = path.join(
    venvBinDir(path.join(configDir, '.venv')),
    process.platform === 'win32' ? 'python.exe' : 'python',
  );
  return fs.existsSync(python) ? python : null;
}

/*
Extracts pyright's --outputjson payload from a captured stream and keeps
only error-severity diagnostics — warnings and information never block.

As with the markdown plugin's parser, npx can prepend its own notices on a
cold cache, so parse the whole thing when it's clean and otherwise fall
back to the braced span. Returns null when no payload can be recovered.
*/
function parsePyrightJson(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  const attempt = (text) => {
    try {
      const parsed = JSON.parse(text);
      return parsed && Array.isArray(parsed.generalDiagnostics) ? parsed : null;
    } catch {
      return null;
    }
  };

  let parsed = attempt(trimmed);
  if (!parsed) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    parsed = attempt(trimmed.slice(start, end + 1));
  }
  if (!parsed) return null;

  return parsed.generalDiagnostics.filter((diag) => diag.severity === 'error');
}

/*
Mirrors pyright's own CLI output: 1-based positions (its JSON ranges are
0-based), a multi-line message's continuation lines indented under it, and
the rule name at the very end.
*/
function formatPyrightReport(diags) {
  return diags
    .map((diag) => {
      const { line, character } = diag.range.start;
      const message = diag.message.replaceAll('\n', '\n    ');
      const rule = diag.rule ? ` (${diag.rule})` : '';
      return `${diag.file}:${line + 1}:${character + 1} - error: ${message}${rule}`;
    })
    .join('\n');
}

/*
Extracts `ruff check --output-format=json`'s array of findings from a
captured stream. As with pyright, a launcher (uvx) can print its own
notices around the payload, so parse the whole thing when it is clean and
otherwise fall back to the bracketed span. Null when no array is found.
*/
function parseRuffJson(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  const attempt = (text) => {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const whole = attempt(trimmed);
  if (whole) return whole;
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  return attempt(trimmed.slice(start, end + 1));
}

// Mirrors `ruff check --output-format=concise`: `path:row:col: CODE message`.
function formatRuffReport(findings) {
  return findings
    .map(({ filename, location, code, message }) => {
      const prefix = code ? `${code} ` : '';
      return `${filename}:${location.row}:${location.column}: ${prefix}${message}`;
    })
    .join('\n');
}

/*
A boolean option from plugin.json's userConfig, surfaced to hook processes
as CLAUDE_PLUGIN_OPTION_<NAME>. Absent (plugin installed before the option
existed, or never configured) reads as off.
*/
function optionEnabled(name) {
  const raw = (process.env[`CLAUDE_PLUGIN_OPTION_${name}`] || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

// `auto_suppress`: write inline ignore comments for what's left at the cap.
function autoSuppressEnabled() {
  return optionEnabled('AUTO_SUPPRESS');
}

/*
`whole_files`: check, fix and format whole touched files even inside a git
repo, rather than only the lines that differ from the session base.
*/
function wholeFilesEnabled() {
  return optionEnabled('WHOLE_FILES');
}

function groupRulesByFileAndLine(diags) {
  const byFile = new Map();
  for (const diag of diags) {
    if (!diag.rule) continue;
    if (!byFile.has(diag.file)) byFile.set(diag.file, new Map());
    const byLine = byFile.get(diag.file);
    const line = diag.range.start.line;
    if (!byLine.has(line)) byLine.set(line, new Set());
    byLine.get(line).add(diag.rule);
  }
  return byFile;
}

/*
Appends `# pyright: ignore[rule, ...]` to each line pyright reported an
error on, merging into an ignore comment already on that line. Diagnostics
without a rule name (syntax errors, mostly) can't be targeted by an
ignore comment and are left alone. Returns what was suppressed, for
logging.
*/
function insertPyrightIgnores(diags) {
  const suppressed = [];
  for (const [file, byLine] of groupRulesByFileAndLine(diags)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const [line, ruleSet] of byLine) {
      if (line >= lines.length) continue;
      const rules = [...ruleSet];
      const existing = /# pyright: ignore\[([^\]]*)\]/.exec(lines[line]);
      if (existing) {
        const merged = [
          ...new Set([...existing[1].split(',').map((r) => r.trim()), ...rules]),
        ].filter(Boolean);
        lines[line] = lines[line].replace(existing[0], `# pyright: ignore[${merged.join(', ')}]`);
      } else if (lines[line].trimEnd().endsWith('\\')) {
        // A comment after a line continuation is a syntax error.
        continue;
      } else {
        // Keep a CRLF file's \r, which trimEnd() would otherwise drop.
        const eol = lines[line].endsWith('\r') ? '\r' : '';
        lines[line] = `${lines[line].trimEnd()}  # pyright: ignore[${rules.join(', ')}]${eol}`;
      }
      suppressed.push({ file, lineNumber: line + 1, rules });
    }
    fs.writeFileSync(file, lines.join('\n'));
  }
  return suppressed;
}

/*
Formats one Python file with a resolved ruff (see resolveTool). Inside a
git repo only ruff's changes on or near the lines that differ from the
session base are written (ad-lfl-kit's formatInScope); outside one, for an
untracked file, or with `wholeFile`, the whole file is formatted in place
as `ruff format` would. --force-exclude keeps the project's `exclude`
honoured for an explicitly named file, and on stdin an excluded file comes
back unchanged.

Returns `{ ok, status?, output? }`: `ok: false` with ruff's output when it
could not format the file (a syntax error, a broken config).
*/
function formatWithRuff(ruff, file, { bases, wholeFile = false } = {}) {
  const options = { cwd: path.dirname(file), encoding: 'utf8' };
  const output = (result) => ((result.stdout || '') + (result.stderr || '')).trim();

  /*
   * Whole file in scope: run the plain `ruff format <file>`, exactly as
   * before scoping existed, rather than a stdin round trip.
   */
  const whole = wholeFile || changedRangesByFile([file], { bases }).get(file)?.all !== false;
  if (whole) {
    const result = runResolved(ruff, ['format', '--force-exclude', file], options);
    if (result.error) throw result.error;
    return result.status === 0
      ? { ok: true, status: 'whole' }
      : { ok: false, output: output(result) };
  }

  const formatStdin = (text) => {
    const result = runResolved(ruff, ['format', '--force-exclude', '--stdin-filename', file, '-'], {
      ...options,
      input: text,
    });
    if (result.error) throw result.error;
    return { ok: result.status === 0, stdout: result.stdout || '', stderr: output(result) };
  };
  const result = formatInScope({ file, formatStdin, bases });
  return result.status === 'skipped'
    ? { ok: false, output: result.reason }
    : { ok: true, status: result.status };
}

/*
Appends `# noqa: CODE, ...` for the given ruff findings, merging into a
noqa directive already on the line. It is the line-scoped counterpart of
`ruff check --add-noqa`, which rewrites every finding in a file: used where
a file also has findings on lines the session didn't change. Each comment
goes on ruff's own `noqa_row` (the end of a multi-line string, say), and
findings without a code (syntax errors) are left alone. Returns what was
suppressed, for logging.
*/
// Ruff findings' codes per file, then per the row their noqa comment goes on.
function groupCodesByFileAndRow(findings) {
  const byFile = new Map();
  for (const finding of findings) {
    if (!finding.code) continue;
    const row = finding.noqa_row ?? finding.location.row;
    if (!byFile.has(finding.filename)) byFile.set(finding.filename, new Map());
    const byRow = byFile.get(finding.filename);
    if (!byRow.has(row)) byRow.set(row, new Set());
    byRow.get(row).add(finding.code);
  }
  return byFile;
}

/*
`line` with a noqa directive for `codes`, or null when it should be left
alone: a blanket `# noqa` already covers it, and a comment after a line
continuation would be a syntax error.
*/
function withNoqa(line, codes) {
  const existing = /# noqa(?::\s*([A-Z0-9, ]+))?/i.exec(line);
  if (existing && !existing[1]) return null;
  if (existing) {
    const merged = new Set([...existing[1].split(',').map((c) => c.trim()), ...codes]);
    merged.delete('');
    return line.replace(existing[0], `# noqa: ${[...merged].join(', ')}`);
  }
  if (line.trimEnd().endsWith('\\')) return null;
  // Keep a CRLF file's \r, which trimEnd() would otherwise drop.
  const eol = line.endsWith('\r') ? '\r' : '';
  return `${line.trimEnd()}  # noqa: ${codes.join(', ')}${eol}`;
}

function insertNoqa(findings) {
  const suppressed = [];
  for (const [file, byRow] of groupCodesByFileAndRow(findings)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    for (const [row, codeSet] of byRow) {
      const codes = [...codeSet];
      const updated = row >= 1 && row <= lines.length ? withNoqa(lines[row - 1], codes) : null;
      if (updated === null) continue;
      lines[row - 1] = updated;
      suppressed.push({ file, lineNumber: row, rules: codes });
    }
    fs.writeFileSync(file, lines.join('\n'));
  }
  return suppressed;
}

module.exports = {
  STATE_NAMESPACE,
  TOUCHED_FILES,
  isPythonFile,
  isIgnoredPath,
  findVenvBinDir,
  resolveTool,
  runResolved,
  resolveConfigDir,
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
};
