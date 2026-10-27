'use strict';

/*
 * Finds the files a tool call wrote when the tool doesn't say which ones.
 *
 * Edit and Write name their target in `tool_input.file_path`, but a Bash or
 * PowerShell command (`sed -i`, a Python script, a code generator) or an MCP
 * tool can write anywhere and reports nothing. So the PreToolUse hook takes a
 * cheap snapshot — a timestamp, the cwd and each repo's HEAD — and the
 * PostToolUse hook asks what changed since:
 *
 *   - in a git repo, the dirty and untracked files (`git status`), plus the
 *     files of any commit made during the call, so `edit && git commit` in one
 *     command isn't missed;
 *   - outside a repo, a bounded walk of the cwd;
 *
 * and in both cases keeps only files whose mtime falls inside the call's
 * window. Pre-existing dirty files the call didn't touch are older than the
 * snapshot, and a `git checkout` / `git pull` leaves the tree clean and brings
 * in commits made before the call, so neither drags unrelated files in.
 *
 * Everything here fails CLOSED, unlike scope.js: a snapshot or a git call
 * that fails resolves to "nothing changed". This module decides which files
 * a session becomes answerable for, and guessing wrong in the other
 * direction would hand Claude somebody else's code.
 */

const fs = require('node:fs');
const path = require('node:path');
const { runBin } = require('./exec');

/*
 * Some filesystems store mtimes at a coarse resolution (FAT and SMB at 2s,
 * some network mounts at 1s), which can round a write made just after the
 * snapshot to just before it.
 */
const MTIME_SLACK_MS = 2000;

/*
 * Directories that are never a session's own source even when a command
 * writes into them — and that a fresh project often hasn't gitignored yet,
 * so `git status` would list every file in them after a `uv sync` or a
 * `pnpm install`.
 */
const PRUNED_DIR_NAMES = new Set([
  '.git',
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
]);

// Upper bound on entries visited by the no-git fallback walk.
const MAX_WALK_ENTRIES = 20000;

const MAX_BUFFER = 64 * 1024 * 1024;

function git(args, cwd) {
  try {
    const result = runBin('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER });
    return !result.error && result.status === 0 ? result.stdout : null;
  } catch {
    return null;
  }
}

function repoRoot(dir) {
  const out = git(['rev-parse', '--show-toplevel'], dir);
  return out ? out.trim() || null : null;
}

function headOf(root) {
  const out = git(['rev-parse', '--verify', '--quiet', 'HEAD'], root);
  return out ? out.trim() || null : null;
}

function isPruned(absPath) {
  return path
    .dirname(absPath)
    .split(path.sep)
    .some((segment) => PRUNED_DIR_NAMES.has(segment));
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/*
 * Taken by the PreToolUse hook. JSON-serialisable on purpose: it is written
 * to the session's state dir and read back by a different process.
 */
function snapshotWorkspace(cwd, { now = Date.now() } = {}) {
  const dir = path.resolve(cwd || process.cwd());
  const root = isDirectory(dir) ? repoRoot(dir) : null;
  return { startedAt: now, cwd: dir, root, head: root ? headOf(root) : null };
}

/*
 * `git status -z` entries are `XY <path>`; a rename or copy is followed by
 * one more NUL-terminated entry holding the original path, which is skipped.
 */
function parseStatus(out, root) {
  const paths = [];
  const entries = out.split('\0');
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    if (/[RC]/.test(entry.slice(0, 2))) i += 1;
    paths.push(path.resolve(root, entry.slice(3)));
  }
  return paths;
}

function dirtyFiles(root) {
  const out = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], root);
  return out === null ? [] : parseStatus(out, root);
}

/*
 * Files touched by commits the call itself made. `--since` drops commits
 * that merely arrived during the call (a pull, a checkout of another
 * branch), which carry their original, older committer dates.
 */
function committedFiles(root, fromHead, startedAt) {
  const head = headOf(root);
  if (!head || head === fromHead) return [];

  const range = fromHead ? [`${fromHead}..${head}`] : [head];
  const since = new Date(startedAt - MTIME_SLACK_MS).toISOString();
  const out = git(['log', '--format=', '--name-only', '-z', `--since=${since}`, ...range], root);
  if (out === null) return [];
  return out
    .split(/[\0\n]/)
    .filter(Boolean)
    .map((rel) => path.resolve(root, rel));
}

function walkFiles(dir) {
  const files = [];
  const stack = [dir];
  let visited = 0;

  while (stack.length > 0 && visited < MAX_WALK_ENTRIES) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!PRUNED_DIR_NAMES.has(entry.name)) stack.push(full);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  return files;
}

function modifiedSince(absPath, since) {
  try {
    const stat = fs.statSync(absPath);
    return stat.isFile() && stat.mtimeMs >= since;
  } catch {
    return false;
  }
}

/*
 * The PostToolUse half: absolute paths of the files written between the
 * snapshot and now. `cwd` is where the session is now, which a `cd` inside
 * the command may have moved away from the snapshot's.
 */
function filesChangedSince(snapshot, { cwd } = {}) {
  if (!snapshot || typeof snapshot.startedAt !== 'number') return [];
  const since = snapshot.startedAt - MTIME_SLACK_MS;

  const candidates = [];
  const roots = new Map();
  if (snapshot.root) roots.set(snapshot.root, snapshot.head);

  const nowDir = cwd ? path.resolve(cwd) : null;
  const nowRoot =
    nowDir && nowDir !== snapshot.cwd && isDirectory(nowDir) ? repoRoot(nowDir) : null;
  // A repo entered mid-command has no recorded HEAD, so its commits are skipped.
  if (nowRoot && !roots.has(nowRoot)) roots.set(nowRoot, undefined);

  for (const [root, head] of roots) {
    candidates.push(...dirtyFiles(root));
    if (head !== undefined) candidates.push(...committedFiles(root, head, snapshot.startedAt));
  }
  if (!snapshot.root && snapshot.cwd && isDirectory(snapshot.cwd)) {
    candidates.push(...walkFiles(snapshot.cwd));
  }

  return [...new Set(candidates)].filter((file) => !isPruned(file) && modifiedSince(file, since));
}

module.exports = {
  MTIME_SLACK_MS,
  PRUNED_DIR_NAMES,
  snapshotWorkspace,
  filesChangedSince,
};
