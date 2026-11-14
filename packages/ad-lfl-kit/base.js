'use strict';

/*
 * The session base: per repository, the HEAD a session started from — the
 * commit its first tracked file in that repo was edited on top of.
 *
 * scope.js narrows a check to the lines that differ from HEAD, on the
 * assumption that nothing the session wrote has been committed yet. A
 * session that commits before its Stop hook runs breaks that assumption:
 * HEAD moves past its own edits, `git diff HEAD` comes back empty, and every
 * finding on those lines reads as pre-existing. Diffing against the session
 * base instead keeps the session's own commits in scope.
 *
 * The base is recorded beside the tracked-file list when a repo's first file
 * is tracked, and read back with readSessionBases() for scopesFor's `bases`
 * option. A Stop hook should list SESSION_BASE_FILE among the state files it
 * cleans up, so that once a check passes, the next turn starts a fresh base
 * from whatever HEAD is then: committed work that passed is no longer the
 * session's to answer for.
 */

const fs = require('node:fs');
const path = require('node:path');

const SESSION_BASE_FILE = 'session-base.json';

function baseFile(dir) {
  return path.join(dir, SESSION_BASE_FILE);
}

/*
 * `{ [repoRoot]: sha }` for the session state dir `dir`; `{}` when nothing
 * was recorded or the file is unreadable — callers then fall back to HEAD.
 */
function readSessionBases(dir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(baseFile(dir), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const bases = {};
    for (const [root, sha] of Object.entries(parsed)) {
      if (typeof sha === 'string' && /^[0-9a-f]{7,64}$/i.test(sha)) bases[root] = sha;
    }
    return bases;
  } catch {
    return {};
  }
}

/*
 * Records `head` as `root`'s base unless one is already recorded: the first
 * sighting wins, since every later one may already sit on top of the
 * session's own commits. Returns whether anything was written.
 */
function recordSessionBase(dir, root, head) {
  if (!root || !head) return false;
  const bases = readSessionBases(dir);
  if (bases[root]) return false;

  bases[root] = head;
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${baseFile(dir)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(bases));
  fs.renameSync(tmp, baseFile(dir));
  return true;
}

/*
 * The recorded repo root that contains `absPath`, deepest first, or null.
 * Lets tracking skip a git call for files in a repo that already has a base.
 */
function knownRootFor(bases, absPath) {
  let best = null;
  for (const root of Object.keys(bases)) {
    const rel = path.relative(root, absPath);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      if (!best || root.length > best.length) best = root;
    }
  }
  return best;
}

module.exports = { SESSION_BASE_FILE, readSessionBases, recordSessionBase, knownRootFor };
