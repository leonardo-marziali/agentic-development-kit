'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

/*
Session-scoped directory for tracking which markdown files this plugin
has touched. Prefers the plugin's own data dir; falls back to tmp so the
hooks still work if CLAUDE_PLUGIN_DATA isn't set.
*/
function stateDir(sessionId) {
  const base = process.env.CLAUDE_PLUGIN_DATA
    ? path.join(process.env.CLAUDE_PLUGIN_DATA, 'markdown-session-scope')
    : path.join(os.tmpdir(), 'claude-markdown-plugin');
  return path.join(base, sessionId || 'unknown-session');
}

const CONFIG_NAMES = [
  '.markdownlint.jsonc',
  '.markdownlint.json',
  '.markdownlint.yaml',
  '.markdownlint.yml',
];

/*
markdownlint-cli only resolves config files relative to its own process
cwd — it does NOT walk up from, or check the directory of, the files it
lints. To respect the nearest .markdownlint.* to each file (including in
a monorepo), we have to do that walk ourselves and invoke the CLI once
per resolved directory, with cwd set there.
*/
function resolveConfigDir(filePath) {
  let dir = path.dirname(path.resolve(filePath));
  const root = path.parse(dir).root;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (CONFIG_NAMES.some((name) => fs.existsSync(path.join(dir, name)))) {
      return dir;
    }
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  /*
  No config found anywhere above the file: cwd doesn't matter, use the
  file's own directory.
  */
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
Locates a node-adjacent CLI shim (npx, npm) across platforms.

Hooks don't inherit a login shell, so PATH can be missing the Node
toolchain entirely; looking beside process.execPath is the reliable
first guess. But the shim is only bare `npx` on POSIX — on Windows it's
`npx.cmd` — and it isn't always installed next to the node binary
(system package managers, some version managers). So probe the real
candidates, and fall back to a bare name for PATH lookup.
*/
function resolveBin(name) {
  const dir = path.dirname(process.execPath);
  const candidates = process.platform === 'win32' ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  for (const candidate of candidates) {
    const full = path.join(dir, candidate);
    if (fs.existsSync(full)) return full;
  }
  return candidates[0];
}

/*
cmd.exe consumes the argument string itself, and spawnSync only
space-joins argv when shell:true — so quote each argument here. Runs of
backslashes before a quote (and at the very end) are doubled first,
since cmd.exe would otherwise treat them as escaping the quote.
*/
function quoteForCmd(arg) {
  const value = String(arg)
    .replace(/(\\*)"/g, '$1$1""')
    .replace(/(\\+)$/, '$1$1');
  return `"${value}"`;
}

/*
Runs a node-adjacent CLI shim. On Windows the shim is a .cmd batch file,
which Node refuses to spawn without a shell, so route through one there
(with arguments quoted by hand); everywhere else spawn argv directly, so
no shell ever parses a file path.
*/
function runBin(name, args, options) {
  const bin = resolveBin(name);
  if (process.platform === 'win32') {
    return spawnSync(quoteForCmd(bin), args.map(quoteForCmd), {
      ...options,
      shell: true,
      windowsVerbatimArguments: true,
    });
  }
  return spawnSync(bin, args, options);
}

/*
Extracts markdownlint-cli's --json payload from a captured stream.

The stream isn't guaranteed to be pure JSON: npx prepends its own
notices ("Need to install the following packages...") on a cold cache,
and a straight JSON.parse of the whole blob then throws — which used to
silently disable auto-suppression. So parse the whole thing when it is
clean, and otherwise fall back to the bracketed span, which is the CLI's
actual payload. Returns null when no JSON array can be recovered.
*/
function parseViolationsJson(raw) {
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

module.exports = {
  stateDir,
  resolveConfigDir,
  groupByConfigDir,
  resolveBin,
  quoteForCmd,
  runBin,
  parseViolationsJson,
};
