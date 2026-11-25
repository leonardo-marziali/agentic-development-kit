#!/usr/bin/env node
'use strict';

/*
 * The Stop hook's ruff and pyright check as a standalone command, for places
 * the plugin's hooks can't run (a git pre-commit hook, an account whose
 * policy allows managed hooks only):
 *
 *   node scripts/check-changes.js [--fix] [--format json|text] [--ref <ref>] -- <paths...>
 *
 * It checks the given Python files and blocks only on findings on lines that
 * differ from <ref> (default HEAD), ±2 lines — the same analysis the hook
 * runs (hooks/checks.js), minus the session: no tracking, no session bases,
 * no attempt loop, no auto-suppression. An untracked file, or a file outside
 * any repository, is checked whole. Paths that aren't .py/.pyi files, or
 * sit in a virtualenv, cache or node_modules, are ignored.
 * CLAUDE_PLUGIN_OPTION_WHOLE_FILES is honoured as in the hook.
 *
 * Without --fix nothing is written. With --fix, `ruff check --fix` and then
 * the scoped `ruff format` run once on the files the hook would fix — those
 * with an in-scope ruff finding and no ruff finding out of scope — and the
 * files are checked again.
 *
 * Exit codes: 0 no blocking finding left, 1 blocking findings remain, 2 the
 * check could not run (ruff or pyright missing or failing, a bad argument).
 * --format json prints one object:
 * { plugin, checked, fixed, findings, outOfScope, warnings }.
 */

const fs = require('node:fs');
const path = require('node:path');
const { runBin } = require('@leonardo-marziali/ad-lfl-kit');

/*
 * The command itself is the same in every plugin's check-changes.js; only
 * PLUGIN, `matches` and `check` differ. `check(files, { fix, bases })`
 * returns { findings, outOfScope, notes, failures, report }: findings in
 * the shape below, `notes` the hook's stderr notes, `failures` the reasons
 * any part of the check did not run, `report` the hook's report text.
 */

const USAGE =
  'usage: node scripts/check-changes.js [--fix] [--format json|text] [--ref <ref>] -- <paths...>';

class UsageError extends Error {}

function parseArgs(argv) {
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
 * --ref, as the session bases every scoping helper already takes: each
 * repository holding one of the files is diffed against that commit. An
 * explicit ref must resolve in every such repository. The default, HEAD,
 * may not (a repository with no commits yet), and is then left to the
 * helpers, which check such files whole.
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

function runCli({ plugin, matches, check }, argv) {
  let options;
  let files;
  let bases;
  try {
    options = parseArgs(argv);
    files = selectFiles(options.paths, matches);
    bases = basesFor(files, options.ref);
  } catch (error) {
    process.stderr.write(`${plugin} plugin: ${error.message}\n${USAGE}\n`);
    return 2;
  }

  const before = options.fix ? contentsOf(files) : null;
  let result = { findings: [], outOfScope: [], notes: [], failures: [], report: '' };
  if (files.length > 0) {
    try {
      result = check(files, { fix: options.fix, bases });
    } catch (error) {
      result = { ...result, failures: [`the check could not run: ${error.message}`] };
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
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    if (result.report) process.stdout.write(`${result.report}\n`);
    for (const warning of warnings) process.stderr.write(`${plugin} plugin: ${warning}\n`);
  }

  // A check that did not run is never reported as clean.
  if (result.failures.length > 0) return 2;
  return result.findings.length > 0 ? 1 : 0;
}

// --- The python plugin's part ---

const { isPythonFile, isIgnoredPath, groupByConfigDir } = require('./hooks/lib');
const { ruffFix, analyze, fixTargets, toOutcome, toFinding } = require('./hooks/checks');

// The hook's check, and with `fix` its fix step first.
function check(files, { fix, bases }) {
  const notes = new Set();
  const failures = new Set();
  const warn = (message, { failed = false } = {}) => (failed ? failures : notes).add(message);
  const groups = groupByConfigDir(files);
  const ctx = { bases, notes: new Set(), warn };
  let scoped = analyze(groups, files, ctx);
  if (fix) {
    const fixable = fixTargets(scoped);
    if (fixable.size > 0) {
      ruffFix(groups, fixable, ctx);
      ctx.notes.clear();
      scoped = analyze(groups, files, ctx);
    }
  }
  return {
    findings: scoped.inScope.map(toFinding),
    outOfScope: scoped.outOfScope.map(toFinding),
    notes: [...ctx.notes, ...notes],
    failures: [...failures],
    report: toOutcome(scoped).report,
  };
}

const COMMAND = {
  plugin: 'python',
  matches: (file) => isPythonFile(file) && !isIgnoredPath(file),
  check,
};

if (require.main === module) process.exitCode = runCli(COMMAND, process.argv.slice(2));

module.exports = { parseArgs, runCli, COMMAND };
