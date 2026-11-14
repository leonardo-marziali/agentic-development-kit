'use strict';

/*
 * Where everything the local analyzer owns lives on disk.
 *
 * Two kinds of location, deliberately kept apart:
 *
 *   - the data dir holds what `install-sloop` downloaded (backend, JRE,
 *     analyzer jars) and SLOOP's own storage. It is large and long-lived.
 *   - the runtime dir holds the per-project daemon's socket, pid and log
 *     files. It is small, per-user, private (0700), and disposable.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/*
 * Resolution order for the data dir:
 *
 *   1. an explicit --data-dir / SONARLINT_HOME
 *   2. CLAUDE_PLUGIN_DATA, which Claude Code exports to hook processes and
 *      keeps across plugin updates (and removes on uninstall)
 *   3. a per-user cache dir, so the CLI still works from a plain shell
 *
 * Skills run the CLI through the Bash tool, where CLAUDE_PLUGIN_DATA is not
 * exported, so they pass --data-dir "${CLAUDE_PLUGIN_DATA}" explicitly. A
 * value that still contains "${" was never substituted and is ignored rather
 * than turned into a directory literally named "${CLAUDE_PLUGIN_DATA}".
 */
function usable(value) {
  return typeof value === 'string' && value.trim() !== '' && !value.includes('${');
}

function defaultCacheDir() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
      'sonarqube-claude',
    );
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Caches', 'sonarqube-claude');
  }
  return path.join(process.env.XDG_CACHE_HOME || path.join(home, '.cache'), 'sonarqube-claude');
}

function dataDir(explicit) {
  for (const candidate of [explicit, process.env.SONARLINT_HOME, process.env.CLAUDE_PLUGIN_DATA]) {
    if (usable(candidate)) return path.resolve(candidate);
  }
  return defaultCacheDir();
}

/*
 * External tools (git, tar, unzip) are looked up in fixed system directories
 * rather than through PATH, so a writable directory early in PATH can't
 * substitute its own `git`. System locations come first; the package-manager
 * prefixes after them only matter where the OS ships no copy of its own.
 */
function systemCommandDirs() {
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || String.raw`C:\Windows`;
    const programFiles = process.env.ProgramFiles || String.raw`C:\Program Files`;
    return [path.join(systemRoot, 'System32'), path.join(programFiles, 'Git', 'cmd')];
  }
  return ['/usr/bin', '/bin', '/usr/local/bin', '/opt/homebrew/bin', '/run/current-system/sw/bin'];
}

// Absolute path of `name` in the system directories, or null if none has it.
function systemCommand(name) {
  const file = process.platform === 'win32' ? `${name}.exe` : name;
  for (const dir of systemCommandDirs()) {
    const candidate = path.join(dir, file);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // not here; try the next directory
    }
  }
  return null;
}

/*
 * spawnSync for a system command. A command that isn't found comes back as an
 * ENOENT `error`, the same shape spawnSync gives for a missing executable.
 */
function spawnSystem(name, args, options) {
  const bin = systemCommand(name);
  if (!bin) {
    const error = new Error(`${name} not found in ${systemCommandDirs().join(', ')}`);
    error.code = 'ENOENT';
    return { error, status: null, stdout: '', stderr: '' };
  }
  return spawnSync(bin, args, options);
}

/*
 * The project root is what SLOOP calls the configuration scope's base dir:
 * the git toplevel when there is one (the same boundary SonarQube for IDE
 * uses), otherwise the directory the caller pointed at.
 */
function projectRoot(startDir) {
  const dir = path.resolve(startDir);
  const result = spawnSystem('git', ['rev-parse', '--show-toplevel'], {
    cwd: dir,
    encoding: 'utf8',
  });
  if (!result.error && result.status === 0 && result.stdout.trim()) {
    return path.resolve(result.stdout.trim());
  }
  return dir;
}

function rootHash(root) {
  return crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 16);
}

function userTag() {
  try {
    const { uid, username } = os.userInfo();
    return uid >= 0
      ? String(uid)
      : crypto.createHash('sha256').update(username).digest('hex').slice(0, 8);
  } catch {
    return 'user';
  }
}

/*
 * A Unix socket path is capped at ~104 bytes (macOS) / 108 (Linux), and
 * TMPDIR inside a sandbox can be long enough to blow that. Fall back to /tmp
 * when the preferred location wouldn't fit.
 */
const MAX_SOCKET_PATH = 100;

function runtimeDir() {
  const preferred = path.join(os.tmpdir(), `sonarlint-${userTag()}`);
  if (process.platform === 'win32') return preferred;
  if (preferred.length + 24 <= MAX_SOCKET_PATH) return preferred;
  return path.join('/tmp', `sonarlint-${userTag()}`);
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') {
    const stat = fs.statSync(dir);
    if (stat.uid !== process.getuid()) {
      throw new Error(`runtime dir ${dir} is owned by another user; refusing to use it`);
    }
    fs.chmodSync(dir, 0o700);
  }
  return dir;
}

function daemonPaths(root) {
  const hash = rootHash(root);
  const dir = runtimeDir();
  return {
    dir,
    hash,
    socket:
      process.platform === 'win32'
        ? String.raw`\\.\pipe\sonarlint-${userTag()}-${hash}`
        : path.join(dir, `${hash}.sock`),
    pid: path.join(dir, `${hash}.pid`),
    log: path.join(dir, `${hash}.log`),
    failed: path.join(dir, `${hash}.failed`),
  };
}

/*
 * Writes a file readable only by the current user, creating or truncating it.
 */
function writePrivateFile(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
}

module.exports = {
  dataDir,
  defaultCacheDir,
  projectRoot,
  systemCommand,
  spawnSystem,
  rootHash,
  runtimeDir,
  ensurePrivateDir,
  daemonPaths,
  writePrivateFile,
  MAX_SOCKET_PATH,
};
