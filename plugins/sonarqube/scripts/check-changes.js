#!/usr/bin/env node
'use strict';

/*
 * The Stop hook's local SonarQube for IDE check as a standalone command, for
 * places the plugin's hooks can't run (a git pre-commit hook, an account
 * whose policy allows managed hooks only):
 *
 *   node scripts/check-changes.js [--fix] [--format json|text] [--ref <ref>] -- <paths...>
 *
 * It analyzes the given files with the plugin's `sonarlint` CLI and applies
 * the hook's blocking policy (hooks/checks.js): a secret blocks wherever it
 * is in a file; other issues block at or above
 * CLAUDE_PLUGIN_OPTION_MIN_BLOCKING_SEVERITY (default HIGH) on lines that
 * differ from <ref> (default HEAD), ±2 lines. An untracked file, or a file
 * outside any repository, is checked whole. Paths git ignores, and the
 * build and vendor directories the hook skips outside a repository, are
 * ignored. The engine's data dir is looked up as in the hook (cli/paths.js):
 * SONARLINT_HOME, then CLAUDE_PLUGIN_DATA, then the per-user cache dir.
 *
 * There is no fix step: --fix is accepted and changes nothing.
 *
 * Exit codes: 0 nothing blocking, 1 blocking findings, 2 the check could
 * not run (SLOOP not installed, a crashed daemon, a timeout, a bad
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

// --- The sonarqube plugin's part ---

const { isAnalyzable } = require('./hooks/lib');
const { analyze } = require('./hooks/checks');

function toFinding(issue) {
  return {
    file: issue.abs,
    line: issue.line ?? null,
    rule: issue.rule,
    message: issue.message,
    severity: issue.severity,
  };
}

// The hook's check; a ToolFailure throws. There is no fix step to run.
function check(files, { fix, bases }) {
  const notes = new Set();
  if (fix) notes.add('the sonarqube check has no fix step; --fix changed nothing.');
  const outcome = analyze(files, { cwd: process.cwd(), notes, bases });
  return {
    findings: outcome.blocking.map(toFinding),
    outOfScope: outcome.outOfScope.map(toFinding),
    notes: [...notes],
    failures: [],
    report: outcome.report,
  };
}

const COMMAND = { plugin: 'sonarqube', matches: isAnalyzable, check };

if (require.main === module) process.exitCode = runCli(COMMAND, process.argv.slice(2));

module.exports = { parseArgs, runCli, COMMAND };
