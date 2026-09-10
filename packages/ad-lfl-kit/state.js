'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/*
 * Session-scoped directory for a hook's own bookkeeping.
 *
 * Prefers the plugin's own data dir, which persists across plugin updates;
 * falls back to tmp so hooks still work when CLAUDE_PLUGIN_DATA isn't set
 * (a repo-local hook, or an older Claude Code). The namespace keeps two
 * plugins' state apart under a shared base.
 */
function stateDir({ sessionId, namespace }) {
  const base = process.env.CLAUDE_PLUGIN_DATA
    ? path.join(process.env.CLAUDE_PLUGIN_DATA, namespace)
    : path.join(os.tmpdir(), namespace);
  return path.join(base, sessionId || 'unknown-session');
}

/*
 * The tracked-file list is append-only newline-delimited text. Entries can go
 * stale within a session — a file gets tracked, then deleted or renamed — so
 * filter to what still exists on every read rather than trusting the list.
 */
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

function writeAttempts(attemptsFile, count) {
  fs.mkdirSync(path.dirname(attemptsFile), { recursive: true });
  fs.writeFileSync(attemptsFile, JSON.stringify({ count }));
}

/*
 * Removes only the files this hook owns, then drops the directory if that
 * leaves it empty — a blind recursive rmSync would also wipe state another
 * hook in the same session still has pending.
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

module.exports = {
  stateDir,
  readTrackedFiles,
  appendTrackedFile,
  readAttempts,
  writeAttempts,
  cleanup,
};
