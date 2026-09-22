'use strict';

/*
 * Narrows a check from "this file" to "the lines in this file that differ
 * from a git ref" — by default HEAD, the last known-clean state.
 *
 * The loop already knows which files a session touched; what it couldn't tell
 * was which parts of them the working tree is actually responsible for. So a
 * one-line edit to a long, already-messy document used to hand Claude every
 * pre-existing violation in it.
 *
 * Scoping against HEAD rather than a session-start snapshot is deliberate:
 * the verdict is then reproducible from a shell (`git diff HEAD`), it
 * survives compaction and session restarts, and it sees every write —
 * including the ones no PostToolUse hook ever hears about, like a `sed -i`,
 * a formatter run from another hook, or the user's own editor.
 *
 * Everything here fails OPEN. No repo, no git, an untracked path, a diff we
 * can't parse — each resolves to "the whole file is in scope", which is
 * exactly the behaviour callers had before this module existed. A scope we
 * failed to compute must never be the reason a linter goes quiet.
 */

const path = require('node:path');
const { runBin } = require('./exec');

const DEFAULT_CONTEXT_LINES = 2;

/*
 * A diff over a large change set can be many megabytes; spawnSync's 1 MiB
 * default would truncate it, and a truncated diff reads as "fewer changed
 * lines" — the one failure this module must not have.
 */
const MAX_BUFFER = 64 * 1024 * 1024;

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

function git(args, cwd) {
  return runBin('git', args, { cwd, encoding: 'utf8', maxBuffer: MAX_BUFFER });
}

function ok(result) {
  return Boolean(result) && !result.error && result.status === 0;
}

function repoRoot(dir) {
  const result = git(['rev-parse', '--show-toplevel'], dir);
  if (!ok(result)) return null;
  return result.stdout.trim() || null;
}

/*
 * Files are grouped by repository so each repo costs a fixed three git
 * invocations however many files it holds, rather than three per file. The
 * root lookup is cached per directory, which is where the repeats are.
 */
function groupByRepo(files) {
  const rootFor = new Map();
  const groups = new Map();
  const outsideRepo = [];

  for (const file of files) {
    const absPath = path.resolve(file);
    const dir = path.dirname(absPath);
    if (!rootFor.has(dir)) rootFor.set(dir, repoRoot(dir));

    const root = rootFor.get(dir);
    if (!root) {
      outsideRepo.push(absPath);
      continue;
    }
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(absPath);
  }

  return { groups, outsideRepo };
}

/*
 * NUL-separated so paths with spaces or newlines survive. Returns null when
 * git couldn't answer, which callers treat as "assume nothing is tracked" and
 * therefore scope whole files.
 */
function readPathSet(result, root) {
  if (!ok(result)) return null;
  const paths = new Set();
  for (const rel of (result.stdout || '').split('\0')) {
    if (rel) paths.add(path.resolve(root, rel));
  }
  return paths;
}

/*
 * Maps one `@@` header to a range of line numbers in the NEW file.
 *
 * `+c,0` is a pure deletion: git points at the line before the splice, so
 * both sides of it go in scope — a violation caused by removing a line (the
 * blank line under a heading, say) is reported against whatever now sits
 * there.
 */
function rangeFromHunk(header) {
  const match = HUNK_HEADER.exec(header);
  if (!match) return null;

  const start = Number(match[1]);
  const count = match[2] === undefined ? 1 : Number(match[2]);
  if (count > 0) return [start, start + count - 1];

  const at = Math.max(start, 1);
  return [at, at + 1];
}

/*
 * Parses `git diff --unified=0 --no-prefix` into ranges per absolute path.
 *
 * The trailing-whitespace strip on the `+++` line is load-bearing: git
 * appends a TAB to that line when the path contains a space, and without it
 * every such file would resolve to a path that exists nowhere and silently
 * drop out of scope.
 */
function parseDiff(text, root) {
  const byFile = new Map();
  let current = null;

  for (const line of (text || '').split('\n')) {
    if (line.startsWith('+++ ')) {
      const target = line.slice(4).replace(/\s+$/, '');
      current = target === '/dev/null' ? null : path.resolve(root, target);
      if (current && !byFile.has(current)) byFile.set(current, []);
      continue;
    }

    if (!current || !line.startsWith('@@')) continue;
    const range = rangeFromHunk(line);
    if (range) byFile.get(current).push(range);
  }

  return byFile;
}

function scopeWholeFile() {
  return { all: true, ranges: [] };
}

/*
 * Resolves one repository's worth of files. `--name-only` is read separately
 * from the unified diff on purpose: it is the authority on WHICH files
 * changed, so a file that changed but whose hunks we failed to parse (an
 * exotically quoted path, a binary file) is caught and scoped whole rather
 * than mistaken for unchanged.
 */
function resolveRepoGroup(root, files, ref, into) {
  const tracked = readPathSet(git(['ls-files', '-z', '--', ...files], root), root);
  const trackedFiles = [];

  for (const file of files) {
    if (tracked && tracked.has(file)) trackedFiles.push(file);
    else into.set(file, scopeWholeFile());
  }
  if (trackedFiles.length === 0) return;

  const changed = readPathSet(
    git(['diff', ref, '--name-only', '-z', '--', ...trackedFiles], root),
    root,
  );
  const diff = git(
    [
      '-c',
      'core.quotePath=false',
      'diff',
      ref,
      '--unified=0',
      '--no-color',
      '--no-ext-diff',
      '--no-renames',
      '--no-prefix',
      '--',
      ...trackedFiles,
    ],
    root,
  );

  if (!changed || !ok(diff)) {
    for (const file of trackedFiles) into.set(file, scopeWholeFile());
    return;
  }

  const ranges = parseDiff(diff.stdout, root);
  for (const file of trackedFiles) {
    if (!changed.has(file)) {
      into.set(file, { all: false, ranges: [] });
      continue;
    }
    const parsed = ranges.get(file);
    into.set(file, parsed && parsed.length > 0 ? { all: false, ranges: parsed } : scopeWholeFile());
  }
}

/*
 * The raw per-file answer, before any context margin is applied:
 * { all, ranges } keyed by absolute path, where `all` means the whole file
 * is in scope.
 */
function changedRangesByFile(files, options = {}) {
  const { ref = 'HEAD' } = options;
  const result = new Map();
  if (!files || files.length === 0) return result;

  const { groups, outsideRepo } = groupByRepo(files);
  for (const file of outsideRepo) result.set(file, scopeWholeFile());
  for (const [root, group] of groups) resolveRepoGroup(root, group, ref, result);

  return result;
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];

  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1];
    // `start - 1` so ranges that merely touch collapse into one.
    if (last && start - 1 <= last[1]) {
      if (end > last[1]) last[1] = end;
      continue;
    }
    merged.push([start, end]);
  }

  return merged;
}

/*
 * Widens each range by `context` lines on either side.
 *
 * Linters routinely report a violation an edit caused against a line the
 * edit didn't touch — append a paragraph under a heading and MD022 fires on
 * the heading above. Only the lower bound is clamped; a range running past
 * the end of the file is harmless, since nothing is ever reported there, and
 * clamping the top would mean reading every file just to count its lines.
 */
function widenRanges(ranges, context) {
  if (context <= 0) return mergeRanges(ranges);
  return mergeRanges(ranges.map(([start, end]) => [Math.max(start - context, 1), end + context]));
}

function makeScope(file, changed, context) {
  const all = changed.all;
  const ranges = all ? [] : widenRanges(changed.ranges, context);

  return {
    file,
    all,
    ranges,
    /*
     * A violation with no line number is in scope only when the whole file
     * is — the linter couldn't place it, so we can't claim the working tree
     * introduced it.
     */
    includes(line) {
      if (all) return true;
      if (typeof line !== 'number' || !Number.isFinite(line)) return false;
      return ranges.some(([start, end]) => line >= start && line <= end);
    },
  };
}

/*
 * The entry point callers want: absolute path → scope, context margin
 * already applied.
 */
function scopesFor(files, options = {}) {
  const { ref = 'HEAD', context = DEFAULT_CONTEXT_LINES } = options;
  const scopes = new Map();

  for (const [file, changed] of changedRangesByFile(files, { ref })) {
    scopes.set(file, makeScope(file, changed, context));
  }

  return scopes;
}

const defaultGetFile = (item) => item.file ?? item.fileName;
const defaultGetLine = (item) => item.line ?? item.lineNumber;

/*
 * Splits a linter's findings into the ones the working tree is answerable
 * for and the ones that were already there. `outOfScopeFiles` is handed back
 * so callers don't have to re-derive it for fixableFiles.
 *
 * A finding whose file has no scope recorded was never scoped at all, so it
 * counts as in scope — fail open, as everywhere else here.
 */
function partitionByScope(items, options = {}) {
  const { scopes, getFile = defaultGetFile, getLine = defaultGetLine } = options;
  const inScope = [];
  const outOfScope = [];
  const outOfScopeFiles = new Set();

  for (const item of items) {
    const file = path.resolve(getFile(item));
    const scope = scopes.get(file);

    if (!scope || scope.includes(getLine(item))) {
      inScope.push(item);
      continue;
    }
    outOfScope.push(item);
    outOfScopeFiles.add(file);
  }

  return { inScope, outOfScope, outOfScopeFiles };
}

/*
 * The files an auto-fixer may safely rewrite: those with nothing out of
 * scope. A `--fix` pass rewrites whole files, so running it on a file that
 * also carries pre-existing violations would quietly "fix" lines that match
 * HEAD — the diff noise this whole module exists to avoid.
 */
function fixableFiles(options = {}) {
  const { files = [], outOfScopeFiles = new Set() } = options;
  return files.filter((file) => !outOfScopeFiles.has(path.resolve(file)));
}

module.exports = {
  DEFAULT_CONTEXT_LINES,
  changedRangesByFile,
  scopesFor,
  partitionByScope,
  fixableFiles,
  mergeRanges,
  widenRanges,
};
