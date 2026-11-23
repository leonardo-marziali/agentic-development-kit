#!/usr/bin/env node
'use strict';

/*
PreToolUse / PostToolUse / PostToolUseFailure hook: formats the files a
tool call just wrote with Prettier, immediately. For Edit, Write and
MultiEdit that's the one file they name; Bash, PowerShell and MCP tools
don't say what they wrote, so PreToolUse snapshots the workspace and the
Post* event formats whatever changed since (ad-lfl-kit's
toolChangedFiles). Unlike the markdown plugin's session-scoped lint loop,
there's nothing to loop on — Prettier either formats a file or leaves it
alone.

Inside a git repo only Prettier's changes on or near the lines that differ
from HEAD are written (ad-lfl-kit's formatInScope), so an edit to an
unformatted file doesn't reformat all of it. Outside a repo, for an
untracked file, or with the plugin's `whole_files` option on, the whole
file is formatted with `--write`, as before.
*/

const fs = require('node:fs');
const path = require('node:path');
const {
  readHookInput,
  runBin,
  stateDir,
  toolChangedFiles,
  changedRangesByFile,
  formatInScope,
} = require('@leonardo-marziali/ad-lfl-kit');
const { wholeFilesEnabled, isNoParserError } = require('./lib');

// Where PreToolUse leaves a shell call's workspace snapshot for its Post* event.
const STATE_NAMESPACE = 'prettier-tool-snapshots';

const IGNORED_DIR_SEGMENTS = [`${path.sep}node_modules${path.sep}`, `${path.sep}.git${path.sep}`];

function isIgnoredPath(absPath) {
  const withTrailingSep = absPath + path.sep;
  return IGNORED_DIR_SEGMENTS.some((segment) => withTrailingSep.includes(segment));
}

function output(result) {
  return ((result.stdout || '') + (result.stderr || '')).trim();
}

/*
 * Formats only the changed lines. `--stdin-filepath` makes Prettier resolve
 * config, plugins and .prettierignore for the real path; an ignored file
 * comes back unchanged.
 */
function formatChangedLines(absPath, cwd) {
  const formatStdin = (text) => {
    const result = runBin('npx', ['-y', 'prettier', '--stdin-filepath', absPath], {
      cwd,
      encoding: 'utf8',
      input: text,
    });
    if (result.error) throw result.error;
    return { ok: result.status === 0, stdout: result.stdout || '', stderr: output(result) };
  };

  let result;
  try {
    result = formatInScope({ file: absPath, formatStdin });
  } catch (err) {
    process.stderr.write(`prettier plugin: invocation failed: ${err.message}\n`);
    return;
  }
  if (result.status === 'skipped' && !isNoParserError(result.reason)) {
    process.stderr.write(`prettier plugin: formatting ${absPath} failed:\n${result.reason}\n`);
  }
}

/*
 * Whether the whole file is in scope: whole_files on, no repository, an
 * untracked file, or a diff scope.js couldn't read.
 */
function formatsWholeFile(absPath) {
  if (wholeFilesEnabled()) return true;
  return changedRangesByFile([absPath]).get(absPath)?.all !== false;
}

function format(absPath, cwd) {
  if (!formatsWholeFile(absPath)) {
    formatChangedLines(absPath, cwd);
    return;
  }

  let result;
  try {
    result = runBin('npx', ['-y', 'prettier', '--write', '--ignore-unknown', absPath], {
      cwd,
      encoding: 'utf8',
    });
  } catch (err) {
    process.stderr.write(`prettier plugin: invocation failed: ${err.message}\n`);
    return;
  }

  if (result.status !== 0) {
    process.stderr.write(`prettier plugin: formatting ${absPath} failed:\n${output(result)}\n`);
  }
}

function main() {
  const input = readHookInput();
  if (!input) return;

  // A notebook is JSON Prettier would reflow; leave NotebookEdit's target alone.
  if (input.tool_name === 'NotebookEdit') return;

  const cwd = input.cwd || process.cwd();
  const files = toolChangedFiles({
    input,
    stateDir: stateDir({ sessionId: input.session_id, namespace: STATE_NAMESPACE }),
  });
  for (const absPath of files) {
    if (!isIgnoredPath(absPath)) format(absPath, cwd);
  }
}

main();
