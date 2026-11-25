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
file is formatted with `--write`, as before. That formatting lives in
checks.js, shared with the standalone changed-lines CLI
(scripts/check-changes.js).
*/

const { readHookInput, stateDir, toolChangedFiles } = require('@leonardo-marziali/ad-lfl-kit');
const { isIgnoredPath, formatFile } = require('./checks');

// Where PreToolUse leaves a shell call's workspace snapshot for its Post* event.
const STATE_NAMESPACE = 'prettier-tool-snapshots';

function warn(message) {
  process.stderr.write(`prettier plugin: ${message}\n`);
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
    if (!isIgnoredPath(absPath)) formatFile(absPath, cwd, { warn });
  }
}

main();
