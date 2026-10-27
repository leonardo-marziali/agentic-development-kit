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
*/

const fs = require('node:fs');
const path = require('node:path');
const {
  readHookInput,
  runBin,
  stateDir,
  toolChangedFiles,
} = require('@leonardo-marziali/ad-lfl-kit');

// Where PreToolUse leaves a shell call's workspace snapshot for its Post* event.
const STATE_NAMESPACE = 'prettier-tool-snapshots';

const IGNORED_DIR_SEGMENTS = [`${path.sep}node_modules${path.sep}`, `${path.sep}.git${path.sep}`];

function isIgnoredPath(absPath) {
  const withTrailingSep = absPath + path.sep;
  return IGNORED_DIR_SEGMENTS.some((segment) => withTrailingSep.includes(segment));
}

function format(absPath, cwd) {
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
    const output = ((result.stdout || '') + (result.stderr || '')).trim();
    process.stderr.write(`prettier plugin: formatting ${absPath} failed:\n${output}\n`);
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
