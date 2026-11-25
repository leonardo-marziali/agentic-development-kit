#!/usr/bin/env node
'use strict';

/*
 * The Stop hook's Java standard check as a standalone command, for places
 * the plugin's hooks can't run (a git pre-commit hook, an account whose
 * policy allows managed hooks only):
 *
 *   node scripts/check-changes.js [--fix] [--format json|text] [--ref <ref>] -- <paths...>
 *
 * It runs the hook's pipeline (hooks/pipeline.js) on the given .java and
 * build files — the source rules, the build-file checks and the NullAway and
 * ArchUnit sections, each as configured in the repository's
 * .claude/java-standards.json — and blocks only on findings on lines that
 * differ from <ref> (default HEAD), ±2 lines (ArchUnit: in the given files).
 * An untracked file is checked whole. Paths that aren't .java or build
 * files, sit in build output, are outside the configured scope, or are in
 * no git repository (where the hook does nothing either) are ignored.
 * Unlike the hook, it has no 165 s time budget: no section is skipped for
 * time.
 *
 * Without --fix nothing is written: the engine checks without formatting.
 * With --fix the engine first formats the changed ranges with the project's
 * Eclipse profile, as the hook does, then the rules are checked.
 *
 * Exit codes: 0 no blocking finding left, 1 blocking findings remain, 2 the
 * check could not run (the engine not installed or failing, a file it could
 * not parse, a section that had to be skipped, a bad argument).
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

// --- The java plugin's part ---

const { isTrackable } = require('./hooks/lib');
const { findRepoRoot, loadConfig, isInScope } = require('./hooks/config');
const { disableBudget } = require('./hooks/budget');
const pipeline = require('./hooks/pipeline');

function toFinding({ file, line, rule, message }) {
  return {
    file: path.resolve(file),
    line: line ?? null,
    rule,
    message,
    severity: 'error',
  };
}

// The hook's check; with `fix`, its formatting of the changed ranges too.
function check(files, { fix, bases }) {
  disableBudget();
  const notes = new Set();
  const failures = new Set();
  pipeline.setWarningSink((message, { failed }) => (failed ? failures : notes).add(message));

  const repos = [...pipeline.groupBy(files, findRepoRoot)].map(([repoRoot, repoFiles]) =>
    pipeline.planRepo(repoRoot, repoFiles, { bases, format: fix }),
  );
  const needsEngine = repos.some(
    (repo) => repo.javaFiles.length > 0 && (repo.config || repo.profile),
  );
  const manifest = needsEngine ? pipeline.engineManifest() : null;
  const outcome = pipeline.check(repos, manifest);

  // Pre-existing findings only show in the report when something blocks.
  const blocking = outcome.sections.flatMap((section) => section.blocking);
  if (!outcome.failed && outcome.report) notes.add(outcome.report);
  return {
    findings: blocking.map(toFinding),
    outOfScope: outcome.sections.flatMap((section) => section.existing).map(toFinding),
    notes: [...notes],
    failures: [...failures],
    report: outcome.failed ? outcome.report : '',
  };
}

/*
 * The hook's own predicate: a tracked kind of file, in a git repository, and
 * inside that repository's configured include/exclude when it has a config.
 */
const configs = new Map();
function matches(file) {
  if (!isTrackable(file)) return false;
  const repoRoot = findRepoRoot(file);
  if (!repoRoot) return false;
  if (!configs.has(repoRoot)) configs.set(repoRoot, loadConfig(repoRoot));
  const config = configs.get(repoRoot);
  return !config || isInScope(file, config, repoRoot);
}

const COMMAND = { plugin: 'java', matches, check };

if (require.main === module) process.exitCode = runCli(COMMAND, process.argv.slice(2));

module.exports = { parseArgs, runCli, COMMAND };
