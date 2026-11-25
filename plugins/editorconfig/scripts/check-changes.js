#!/usr/bin/env node
'use strict';

/*
 * The Stop hook's EditorConfig check as a standalone command, for places the
 * plugin's hooks can't run (a git pre-commit hook, an account whose policy
 * allows managed hooks only):
 *
 *   node scripts/check-changes.js [--fix] [--format json|text] [--ref <ref>] -- <paths...>
 *
 * It checks the given files against their .editorconfig and blocks only on
 * violations on lines that differ from <ref> (default HEAD), ±2 lines — the
 * same analysis the hook runs (hooks/checks.js), with the same backend
 * choice: the ec4j Maven or Gradle plugin where the build declares it,
 * editorconfig-checker otherwise, and the checker again wherever ec4j can't
 * be narrowed to the given files. An untracked file, or a file outside any
 * repository, is checked whole. Paths under node_modules or .git, and files
 * no .editorconfig applies to, are ignored.
 *
 * Without --fix nothing is written. With --fix, `editorconfig-checker --fix`
 * or ec4j's format runs once on the files the hook would fix — those with an
 * in-scope violation and none out of scope — and the files are checked
 * again.
 *
 * Exit codes: 0 no blocking violation left, 1 blocking violations remain,
 * 2 the check could not run (no usable checker, a crashed tool, a bad
 * argument). --format json prints one object:
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

// --- The editorconfig plugin's part ---

const { isEnforceable, hasEditorconfig, groupByBackend } = require('./hooks/lib');
const { analyze, fixTargets, fixGroups, toReport, toFinding } = require('./hooks/checks');

// The hook's check, and with `fix` its fix step first. A ToolFailure throws.
function check(files, { fix, bases }) {
  const cwd = process.cwd();
  const groups = groupByBackend(files);
  const ctx = { cwd, notes: new Set(), bases };
  let scoped = analyze(groups, files, ctx);
  if (fix) {
    const fixable = fixTargets(scoped);
    if (fixable.size > 0) {
      fixGroups(groups, fixable, ctx);
      scoped = analyze(groups, files, ctx);
    }
  }
  return {
    findings: scoped.inScope.map(toFinding),
    outOfScope: scoped.outOfScope.map(toFinding),
    notes: [...ctx.notes],
    failures: [],
    report: toReport(scoped.inScope, cwd),
  };
}

const COMMAND = {
  plugin: 'editorconfig',
  matches: (file) => isEnforceable(file) && hasEditorconfig(file),
  check,
};

if (require.main === module) process.exitCode = runCli(COMMAND, process.argv.slice(2));

module.exports = { parseArgs, runCli, COMMAND };
