'use strict';

/*
 * Everything the daemon hands SLOOP is read from disk on the daemon's
 * authority, so every path is held to the project root first. A request for
 * `../../etc/passwd`, or a symlink inside the project that points out of it,
 * is refused rather than read.
 */

const fs = require('node:fs');
const path = require('node:path');

function isInside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/*
 * Resolves `requested` (absolute, or relative to `root`) and checks it is
 * inside the project root. Returns { ok, abs, reason }, where `abs` is
 * expressed under the root's real path so the same file always gets the same
 * URI no matter which spelling of the root (/tmp vs /private/tmp, say) the
 * caller used.
 *
 * `mustExist: false` is for virtual files (stdin analysis): nothing is read,
 * but the nearest existing ancestor must still really be inside the root, so
 * a symlinked directory can't smuggle the path out either.
 */
function resolveInside(root, requested, { mustExist = true } = {}) {
  const lexicalRoot = path.resolve(root);
  const realRoot = fs.realpathSync(lexicalRoot);
  const lexical = path.resolve(lexicalRoot, requested);

  let underReal;
  if (isInside(realRoot, lexical)) underReal = lexical;
  else if (isInside(lexicalRoot, lexical))
    underReal = path.join(realRoot, path.relative(lexicalRoot, lexical));
  else return { ok: false, abs: lexical, reason: 'outside the project root' };

  if (mustExist) {
    let real;
    try {
      real = fs.realpathSync(underReal);
    } catch {
      return { ok: false, abs: lexical, reason: 'not found' };
    }
    if (!isInside(realRoot, real))
      return { ok: false, abs: lexical, reason: 'resolves outside the project root' };
    if (!fs.statSync(real).isFile())
      return { ok: false, abs: lexical, reason: 'not a regular file' };
    return { ok: true, abs: real };
  }

  let ancestor = path.dirname(underReal);
  while (!fs.existsSync(ancestor) && ancestor !== path.dirname(ancestor))
    ancestor = path.dirname(ancestor);
  if (!isInside(realRoot, fs.realpathSync(ancestor))) {
    return { ok: false, abs: lexical, reason: 'resolves outside the project root' };
  }
  return { ok: true, abs: underReal };
}

module.exports = { isInside, resolveInside };
