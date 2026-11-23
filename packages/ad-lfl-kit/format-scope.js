'use strict';

/*
 * Runs a formatter over a file but keeps only the changes it makes near the
 * lines the working tree changed — scope.js's notion of "changed", the same
 * one the narrowed linters use.
 *
 * Formatters work on whole files, and the range options some of them have
 * (`ruff format --range`, Prettier's `--range-start`/`--range-end`) take one
 * range per run, widen it to the enclosing node, and work only for some
 * languages. So instead: format the whole text in memory, diff it against
 * the original, and apply only the hunks whose original lines overlap the
 * changed ranges (widened by the usual context margin). That works the same
 * for every formatter that can read stdin.
 *
 * Wherever scope.js would scope the whole file — no repository, an untracked
 * file, a diff it couldn't read — the whole formatted text is written, which
 * is what a plain `--write` would have done.
 *
 * Applying some hunks and not others can, in principle, leave text the
 * formatter can't parse. The partial result is fed back through the
 * formatter once, and written only if that succeeds: a file is never left
 * in a state its own formatter rejects.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runBin } = require('./exec');
const {
  DEFAULT_CONTEXT_LINES,
  changedRangesByFile,
  parseHunkHeader,
  widenRanges,
} = require('./scope');

const MAX_BUFFER = 64 * 1024 * 1024;

/*
 * Lines with their terminators kept, so CRLF and a missing final newline
 * survive a round trip: joining the chunks gives back the exact text.
 */
function splitLines(text) {
  return text.match(/[^\n]*\n|[^\n]+$/g) || [];
}

/*
 * The hunks between `before` and `after`, as git sees them with no context.
 * `git diff --no-index` exits 1 when the files differ, so 0 and 1 are both
 * answers; anything else is a failure and returns null.
 */
function diffHunks(before, after) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ad-lfl-kit-format-'));
  try {
    const a = path.join(dir, 'a');
    const b = path.join(dir, 'b');
    fs.writeFileSync(a, before);
    fs.writeFileSync(b, after);
    const result = runBin(
      'git',
      ['diff', '--no-index', '--no-color', '--no-ext-diff', '--unified=0', '--', a, b],
      { encoding: 'utf8', maxBuffer: MAX_BUFFER },
    );
    if (!result || result.error || (result.status !== 0 && result.status !== 1)) return null;
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
 * The lines of the ORIGINAL a hunk touches. A pure insertion (`-a,0`) sits
 * after line a, so both neighbours count — the same rule scope.js applies
 * to pure deletions on the other side of its diff.
 */
function oldRange({ oldStart, oldCount }) {
  if (oldCount > 0) return [oldStart, oldStart + oldCount - 1];
  const at = Math.max(oldStart, 1);
  return [at, at + 1];
}

/*
 * git merges adjacent changed lines into one hunk, so a formatter that
 * touches every line of a messy file would produce a single hunk that
 * overlaps any edit. A hunk that replaces N lines with N lines is really N
 * independent line replacements, and is split into them; one that changes
 * the line count can't be split safely and stays whole.
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

function overlaps([start, end], ranges) {
  return ranges.some(([from, to]) => start <= to && end >= from);
}

/*
 * Replaces each kept hunk's original lines with the formatter's lines,
 * bottom-up so the line numbers of hunks above stay valid.
 */
function applyHunks(original, formatted, hunks) {
  const lines = splitLines(original);
  const formattedLines = splitLines(formatted);
  const sorted = [...hunks].sort((x, y) => y.oldStart - x.oldStart);

  for (const { oldStart, oldCount, newStart, newCount } of sorted) {
    const at = oldCount > 0 ? oldStart - 1 : oldStart;
    const replacement =
      newCount > 0 ? formattedLines.slice(newStart - 1, newStart - 1 + newCount) : [];
    lines.splice(at, oldCount, ...replacement);
  }
  return lines.join('');
}

function failureReason(result) {
  return (result.stderr || result.stdout || 'formatter failed').trim();
}

/*
 * Formats `file` in place, limited to its changed lines.
 *
 * - `formatStdin(text) → { ok, stdout, stderr }` runs the formatter on text
 *   as if it were `file`'s content (e.g. `prettier --stdin-filepath file`).
 * - `bases` is scopesFor's option: session bases per repository root.
 * - `context` widens each changed range, DEFAULT_CONTEXT_LINES by default.
 *
 * Returns `{ status, reason? }`: `whole` (the whole file was in scope and
 * got formatted), `narrowed` (only some of the formatter's changes were
 * applied), `unchanged` (nothing in scope to change), or `skipped` (the
 * formatter failed; the file was not touched).
 */
function formatInScope({ file, formatStdin, bases, context = DEFAULT_CONTEXT_LINES }) {
  const absPath = path.resolve(file);
  const original = fs.readFileSync(absPath, 'utf8');

  const first = formatStdin(original);
  if (!first.ok) return { status: 'skipped', reason: failureReason(first) };
  const formatted = first.stdout;
  if (formatted === original) return { status: 'unchanged' };

  const changed = changedRangesByFile([absPath], { bases }).get(absPath);
  if (!changed || changed.all) {
    fs.writeFileSync(absPath, formatted);
    return { status: 'whole' };
  }

  const ranges = widenRanges(changed.ranges, context);
  const hunks = diffHunks(original, formatted);
  if (!hunks) return { status: 'skipped', reason: 'could not diff the formatted output' };

  const kept = hunks.flatMap(splitOneToOne).filter((hunk) => overlaps(oldRange(hunk), ranges));
  if (kept.length === 0) return { status: 'unchanged' };

  const partial = applyHunks(original, formatted, kept);
  const recheck = formatStdin(partial);
  if (!recheck.ok) return { status: 'skipped', reason: failureReason(recheck) };

  fs.writeFileSync(absPath, partial);
  return { status: 'narrowed' };
}

module.exports = { formatInScope };
