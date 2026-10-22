'use strict';

/*
 * The Python-specific half of this plugin's hooks. The generic loop
 * machinery — hook input, session state, file tracking, the capped fix loop,
 * spawning CLI shims — comes from @leonardo-marziali/ad-lfl-kit.
 */

const fs = require('node:fs');
const path = require('node:path');

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

// Walks up from `fromDir` to the nearest `.venv` and returns its bin dir.
function findVenvBinDir(fromDir) {
  let dir = path.resolve(fromDir);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const bin = venvBinDir(path.join(dir, '.venv'));
    if (fs.existsSync(bin)) return bin;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function executableNames(name) {
  if (process.platform !== 'win32') return [name];
  const exts = (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').filter(Boolean);
  return exts.map((ext) => name + ext.toLowerCase());
}

function hasExecutable(dir, name) {
  return executableNames(name).some((candidate) => {
    const full = path.join(dir, candidate);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return fs.statSync(full).isFile();
    } catch {
      return false;
    }
  });
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
runner. Returns { name, prefix, extraDirs } for runBin, or null when
nothing can run it — callers fail open in that case rather than block.

The PATH search is done by hand because runBin's own resolution falls
back to the bare name without knowing whether it exists, and the fallback
runner should only be reached when it doesn't.
*/
function resolveTool(tool, { fromDir } = {}) {
  const venvBin = fromDir ? findVenvBinDir(fromDir) : null;
  if (venvBin && hasExecutable(venvBin, tool)) {
    return { name: tool, prefix: [], extraDirs: [venvBin] };
  }
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

const CONFIG_NAMES = ['pyrightconfig.json', 'pyproject.toml'];

/*
Ruff resolves its config per file on its own, but pyright reads exactly
one config per run. To respect the nearest config to each file (including
in a monorepo), files are grouped by their nearest config directory and
pyright runs once per group with `-p` pointed there.
*/
function resolveConfigDir(filePath) {
  let dir = path.dirname(path.resolve(filePath));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (CONFIG_NAMES.some((name) => fs.existsSync(path.join(dir, name)))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // No config anywhere above the file: use the file's own directory.
  return path.dirname(path.resolve(filePath));
}

function groupByConfigDir(files) {
  const groups = new Map();
  for (const file of files) {
    const dir = resolveConfigDir(file);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(file);
  }
  return groups;
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
    if (/^\s*"?venv"?\s*[:=]/m.test(fs.readFileSync(configFile, 'utf8'))) return null;
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
      const message = diag.message.replace(/\n/g, '\n    ');
      const rule = diag.rule ? ` (${diag.rule})` : '';
      return `${diag.file}:${line + 1}:${character + 1} - error: ${message}${rule}`;
    })
    .join('\n');
}

/*
`auto_suppress` in plugin.json's userConfig, surfaced to hook processes
as CLAUDE_PLUGIN_OPTION_AUTO_SUPPRESS. Absent (plugin installed before
the option existed, or never configured) reads as off.
*/
function autoSuppressEnabled() {
  const raw = (process.env.CLAUDE_PLUGIN_OPTION_AUTO_SUPPRESS || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
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

module.exports = {
  STATE_NAMESPACE,
  TOUCHED_FILES,
  isPythonFile,
  isIgnoredPath,
  findVenvBinDir,
  resolveTool,
  resolveConfigDir,
  groupByConfigDir,
  pythonPathFor,
  parsePyrightJson,
  formatPyrightReport,
  autoSuppressEnabled,
  insertPyrightIgnores,
};
