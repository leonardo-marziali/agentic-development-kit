'use strict';

/*
Shared helpers for this repo's own development hooks. These are NOT part
of any published plugin — they exist to keep changes to the plugins'
hook sources honest while working in this repository, and are registered
from .claude/settings.json.
*/

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

/*
Session-scoped state directory. Repo hooks get no CLAUDE_PLUGIN_DATA
(that's plugin-scoped), so this always lives under the OS temp dir.
*/
function stateDir(sessionId) {
  const base = process.env.ADK_HOOKS_STATE_DIR || path.join(os.tmpdir(), 'adk-repo-hooks');
  return path.join(base, sessionId || 'unknown-session');
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function readHookInput() {
  try {
    return JSON.parse(readStdin() || '{}');
  } catch {
    return null;
  }
}

/*
The scope these hooks watch: any .js file under a plugin's own
scripts/hooks/ directory — hook implementations and their test suites.
Returns that plugin's root (plugins/<name>) for a matching path, or null.

Matching on the path shape rather than a hardcoded list means a new
plugin is covered the moment it exists, with nothing to register.
*/
function pluginRootForHookSource(absPath) {
  if (!/\.js$/i.test(absPath)) return null;
  const segments = absPath.split(path.sep);
  for (let i = 0; i + 3 < segments.length; i++) {
    if (
      segments[i] === 'plugins' &&
      segments[i + 2] === 'scripts' &&
      segments[i + 3] === 'hooks' &&
      segments.length > i + 4
    ) {
      return segments.slice(0, i + 2).join(path.sep);
    }
  }
  return null;
}

function readTrackedFiles(listFile) {
  if (!fs.existsSync(listFile)) return [];
  return [...new Set(fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean))].filter(
    (file) => fs.existsSync(file),
  );
}

function appendTrackedFile(listFile, absPath) {
  const existing = fs.existsSync(listFile)
    ? fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean)
    : [];
  if (!existing.includes(absPath)) {
    fs.appendFileSync(listFile, absPath + '\n');
  }
}

function readAttempts(attemptsFile) {
  if (!fs.existsSync(attemptsFile)) return 0;
  try {
    return JSON.parse(fs.readFileSync(attemptsFile, 'utf8')).count || 0;
  } catch {
    return 0;
  }
}

/*
Removes only the files this hook owns, then drops the directory if that
leaves it empty — a blind recursive rmSync would also wipe state another
hook still has pending.
*/
function cleanup(dir, ownStateFiles) {
  for (const name of ownStateFiles) {
    try {
      fs.rmSync(path.join(dir, name), { force: true });
    } catch {
      // best effort
    }
  }
  try {
    fs.rmdirSync(dir);
  } catch {
    // not empty (another hook's state still pending) or already gone
  }
}

/*
Locates a node-adjacent CLI shim (pnpm). Hooks don't inherit a login
shell, so PATH can be missing the toolchain entirely; looking beside
process.execPath is the reliable first guess. On Windows the shim is
`pnpm.cmd`, and it isn't always installed next to the node binary, so
probe the real candidates and fall back to a bare name for PATH lookup.
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
backslashes before a quote (and at the very end) are doubled first, since
cmd.exe would otherwise treat them as escaping the quote.
*/
function quoteForCmd(arg) {
  const value = String(arg).replace(/(?<!\\)(\\*)"/g, '$1$1""');
  let trailingSlashes = 0;
  for (let i = value.length - 1; i >= 0 && value[i] === '\\'; i--) {
    trailingSlashes++;
  }
  return `"${value}${value.slice(-trailingSlashes)}"`;
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

module.exports = {
  stateDir,
  readHookInput,
  pluginRootForHookSource,
  readTrackedFiles,
  appendTrackedFile,
  readAttempts,
  cleanup,
  resolveBin,
  quoteForCmd,
  runBin,
};
