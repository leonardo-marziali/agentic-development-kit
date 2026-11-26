'use strict';

/*
 * The command line every plugin's scripts/check-changes.js shares: the Stop
 * hook's check as a standalone command, for callers that can't run hooks
 * (a git pre-commit hook, a Claude rule under `allowManagedHooksOnly`).
 *
 *   node scripts/check-changes.js [--fix] [--format json|text] [--ref <ref>] -- <paths...>
 *
 * A plugin supplies only what differs: its name, the predicate for the
 * files its hook would check, and `check(files, { fix, bases })`, which
 * returns { findings, outOfScope, notes, failures, report }:
 *
 * - findings: the blocking in-scope findings, as { file, line, rule,
 *   message, severity }
 * - outOfScope: the findings left alone because they are outside the
 *   changed lines, in any shape with a `file`
 * - notes: what the hook would print on stderr
 * - failures: why any part of the check did not run
 * - report: the text the Stop hook would show Claude
 *
 * `bases` is --ref as the session bases every scoping helper already takes
 * (repository root → commit), so `scopesFor`, `formatInScope` and the rest
 * scope to the lines changed since that commit with no other change.
 *
 * Exit codes: 0 when no blocking in-scope finding is left, 1 when some
 * are, 2 when the check could not run (bad arguments, an unknown ref, or
 * any failure). A check that didn't run never exits 0, and 2 wins over 1.
 */

const fs = require('node:fs');
const path = require('node:path');
const { runBin } = require('./exec');

const CHECK_CHANGES_USAGE =
  'usage: node scripts/check-changes.js [--fix] [--format json|text] [--ref <ref>] -- <paths...>';

class UsageError extends Error {}

function parseCheckChangesArgs(argv) {
  const options = { fix: false, format: 'text', ref: null, paths: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      options.paths.push(...argv.slice(i + 1));
      break;
    }
    const [name, inline] = arg.split(/=(.*)/s, 2);
    if (name === '--fix' && inline === undefined) options.fix = true;
    else if (name === '--format' || name === '--ref') {
      const value = inline ?? argv[++i];
      if (!value) throw new UsageError(`${name} needs a value`);
      options[name.slice(2)] = value;
    } else if (arg.startsWith('-')) throw new UsageError(`unknown option ${arg}`);
    else options.paths.push(arg);
  }
  if (!['json', 'text'].includes(options.format)) {
    throw new UsageError(`--format must be json or text, not ${options.format}`);
  }
  return options;
}

function git(args, cwd) {
  const result = runBin('git', args, { cwd, encoding: 'utf8' });
  return !result.error && result.status === 0 ? result.stdout.trim() : null;
}

/*
 * Each repository holding one of the files is diffed against the ref's
 * commit. An explicit ref must resolve in every such repository. The
 * default, HEAD, may not (a repository with no commits yet), and is then
 * left to the helpers, which check such files whole.
 */
function basesFor(files, ref) {
  const bases = new Map();
  const roots = new Set(
    files.map((file) => git(['rev-parse', '--show-toplevel'], path.dirname(file))),
  );
  for (const root of roots) {
    if (!root) continue;
    const commit = git(['rev-parse', '--verify', '--quiet', `${ref ?? 'HEAD'}^{commit}`], root);
    if (commit) bases.set(root, commit);
    else if (ref) throw new UsageError(`--ref ${ref} does not name a commit in ${root}`);
  }
  return bases;
}

// Paths that don't exist or that the plugin wouldn't check are ignored.
function selectFiles(paths, matches) {
  const files = [...new Set(paths.map((p) => path.resolve(p)))];
  return files.filter(
    (file) => fs.statSync(file, { throwIfNoEntry: false })?.isFile() && matches(file),
  );
}

function contentsOf(files) {
  return new Map(files.map((file) => [file, fs.readFileSync(file)]));
}

function changedSince(before) {
  return [...before]
    .filter(([file, bytes]) => !bytes.equals(fs.readFileSync(file)))
    .map(([file]) => file);
}

function countByFile(findings) {
  const counts = new Map();
  for (const { file } of findings) counts.set(file, (counts.get(file) || 0) + 1);
  return [...counts].map(([file, count]) => ({ file, count }));
}

const EMPTY_RESULT = { findings: [], outOfScope: [], notes: [], failures: [], report: '' };

/*
 * Runs the command and returns its exit code; the caller exits with it.
 * `io` is where the output goes, for tests.
 */
function runCheckChanges({ plugin, matches, check }, argv, io = {}) {
  const { stdout = process.stdout, stderr = process.stderr } = io;
  let options;
  let files;
  let bases;
  try {
    options = parseCheckChangesArgs(argv);
    files = selectFiles(options.paths, matches);
    bases = basesFor(files, options.ref);
  } catch (error) {
    stderr.write(`${plugin} plugin: ${error.message}\n${CHECK_CHANGES_USAGE}\n`);
    return 2;
  }

  const before = options.fix ? contentsOf(files) : null;
  let result = EMPTY_RESULT;
  if (files.length > 0) {
    try {
      result = { ...EMPTY_RESULT, ...check(files, { fix: options.fix, bases }) };
    } catch (error) {
      result = { ...EMPTY_RESULT, failures: [`the check could not run: ${error.message}`] };
    }
  }

  const warnings = [...result.notes, ...result.failures];
  if (options.format === 'json') {
    const output = {
      plugin,
      checked: files,
      fixed: before ? changedSince(before) : [],
      findings: result.findings,
      outOfScope: countByFile(result.outOfScope),
      warnings,
    };
    stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    if (result.report) stdout.write(`${result.report}\n`);
    for (const warning of warnings) stderr.write(`${plugin} plugin: ${warning}\n`);
  }

  if (result.failures.length > 0) return 2;
  return result.findings.length > 0 ? 1 : 0;
}

module.exports = {
  CHECK_CHANGES_USAGE,
  parseCheckChangesArgs,
  runCheckChanges,
};
