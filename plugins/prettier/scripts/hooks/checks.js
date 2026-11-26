'use strict';

/*
 * Prettier formatting as the PostToolUse hook (format.js) runs it, and the
 * same decision made without writing, for the standalone changed-lines CLI
 * (scripts/check-changes.js). Kept here so both work on the same lines.
 *
 * Inside a git repo only Prettier's changes on or near the lines that differ
 * from HEAD (or the given bases) are written (ad-lfl-kit's formatInScope),
 * so an edit to an unformatted file doesn't reformat all of it. Outside a
 * repo, for an untracked file, or with the plugin's `whole_files` option
 * on, the whole file is formatted with `--write`.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  runBin,
  changedRangesByFile,
  formatInScope,
  parseHunkHeader,
  widenRanges,
  DEFAULT_CONTEXT_LINES,
} = require('@leonardo-marziali/ad-lfl-kit');
const { wholeFilesEnabled, isNoParserError } = require('./lib');

const IGNORED_DIR_SEGMENTS = [`${path.sep}node_modules${path.sep}`, `${path.sep}.git${path.sep}`];

function isIgnoredPath(absPath) {
  const withTrailingSep = absPath + path.sep;
  return IGNORED_DIR_SEGMENTS.some((segment) => withTrailingSep.includes(segment));
}

function output(result) {
  return ((result.stdout || '') + (result.stderr || '')).trim();
}

/*
 * Prettier on `text` as if it were `absPath`'s content. `--stdin-filepath`
 * makes Prettier resolve config, plugins and .prettierignore for the real
 * path; an ignored file comes back unchanged.
 */
function stdinFormatter(absPath, cwd) {
  return (text) => {
    const result = runBin('npx', ['-y', 'prettier', '--stdin-filepath', absPath], {
      cwd,
      encoding: 'utf8',
      input: text,
    });
    if (result.error) throw result.error;
    return { ok: result.status === 0, stdout: result.stdout || '', stderr: output(result) };
  };
}

/*
 * Whether the whole file is in scope: whole_files on, no repository, an
 * untracked file, or a diff scope.js couldn't read.
 */
function formatsWholeFile(absPath, bases) {
  if (wholeFilesEnabled()) return true;
  return changedRangesByFile([absPath], { bases }).get(absPath)?.all !== false;
}

/*
 * Formats `absPath` the way the hook does. `warn(message)` receives what the
 * hook writes to stderr; the return value says whether Prettier could do its
 * job: `{ ok: false, reason }` when it could not run or not parse the file.
 * A file with no parser is not Prettier's to format, and is `ok`.
 */
function formatFile(absPath, cwd, { bases, warn }) {
  if (!formatsWholeFile(absPath, bases)) {
    let result;
    try {
      result = formatInScope({ file: absPath, formatStdin: stdinFormatter(absPath, cwd), bases });
    } catch (err) {
      warn(`invocation failed: ${err.message}`);
      return { ok: false, reason: err.message };
    }
    if (result.status === 'skipped' && !isNoParserError(result.reason)) {
      warn(`formatting ${absPath} failed:\n${result.reason}`);
      return { ok: false, reason: result.reason };
    }
    return { ok: true };
  }

  let result;
  try {
    result = runBin('npx', ['-y', 'prettier', '--write', '--ignore-unknown', absPath], {
      cwd,
      encoding: 'utf8',
    });
  } catch (err) {
    warn(`invocation failed: ${err.message}`);
    return { ok: false, reason: err.message };
  }
  if (result.status !== 0) {
    warn(`formatting ${absPath} failed:\n${output(result)}`);
    return { ok: false, reason: output(result) || result.error?.message || 'prettier failed' };
  }
  return { ok: true };
}

/*
 * The hunks between two texts, as `git diff --unified=0` sees them — the
 * same diff formatInScope takes its hunks from. Null when git can't answer.
 */
function diffHunks(before, after) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prettier-plugin-check-'));
  try {
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    fs.writeFileSync(a, before);
    fs.writeFileSync(b, after);
    const result = runBin(
      'git',
      ['diff', '--no-index', '--no-color', '--no-ext-diff', '--unified=0', '--', a, b],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    if (result.error || (result.status !== 0 && result.status !== 1)) return null;
    return (result.stdout || '')
      .split('\n')
      .filter((line) => line.startsWith('@@'))
      .map(parseHunkHeader)
      .filter(Boolean);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/*
 * formatInScope's own rules for which hunks it keeps: a hunk replacing N
 * lines with N is N independent line changes, a pure insertion touches both
 * neighbours, and a hunk is kept when it overlaps a widened changed range.
 */
function splitOneToOne(hunk) {
  const { oldStart, oldCount, newStart, newCount } = hunk;
  if (oldCount <= 1 || oldCount !== newCount) return [hunk];
  return Array.from({ length: oldCount }, (_, i) => ({
    oldStart: oldStart + i,
    oldCount: 1,
    newStart: newStart + i,
    newCount: 1,
  }));
}

function oldRange({ oldStart, oldCount }) {
  if (oldCount > 0) return [oldStart, oldStart + oldCount - 1];
  const at = Math.max(oldStart, 1);
  return [at, at + 1];
}

function overlaps([start, end], ranges) {
  return ranges.some(([from, to]) => start <= to && end >= from);
}

/*
 * What formatting `absPath` would change, without writing anything:
 * `{ ok, inScope, outOfScope }` where each is a list of `[start, end]` line
 * ranges of the current file that Prettier would rewrite — `inScope` those
 * the hook would write, `outOfScope` those it would leave. `{ ok: false,
 * reason }` when Prettier could not run or not parse the file.
 */
function pendingChanges(absPath, cwd, { bases }) {
  const original = fs.readFileSync(absPath, 'utf8');
  const first = stdinFormatter(absPath, cwd)(original);
  if (!first.ok) {
    const reason = first.stderr || 'prettier failed';
    return isNoParserError(reason)
      ? { ok: true, inScope: [], outOfScope: [] }
      : { ok: false, reason };
  }
  if (first.stdout === original) return { ok: true, inScope: [], outOfScope: [] };

  const hunks = diffHunks(original, first.stdout);
  if (!hunks) return { ok: false, reason: 'could not diff the formatted output' };
  const all = hunks.flatMap(splitOneToOne).map(oldRange);
  if (formatsWholeFile(absPath, bases)) return { ok: true, inScope: all, outOfScope: [] };

  const changed = changedRangesByFile([absPath], { bases }).get(absPath);
  const ranges = widenRanges(changed.ranges, DEFAULT_CONTEXT_LINES);
  return {
    ok: true,
    inScope: all.filter((range) => overlaps(range, ranges)),
    outOfScope: all.filter((range) => !overlaps(range, ranges)),
  };
}

module.exports = { isIgnoredPath, formatFile, pendingChanges };
