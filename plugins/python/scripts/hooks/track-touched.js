#!/usr/bin/env node
'use strict';

/*
PreToolUse / PostToolUse / PostToolUseFailure hook: records every Python
file this session creates or edits, so the Stop/SubagentStop hooks only
ever check files this session actually touched — never pre-existing code.

Edit-family tools name their file; for Bash, PowerShell and MCP tools,
which don't, PreToolUse snapshots the workspace and the Post* event
tracks whatever changed since (see ad-lfl-kit's trackSessionChanges).
*/

const path = require('node:path');
const { readHookInput, stateDir, trackSessionChanges } = require('@leonardo-marziali/ad-lfl-kit');
const { STATE_NAMESPACE, TOUCHED_FILES, isPythonFile, isIgnoredPath } = require('./lib');

function main() {
  const input = readHookInput();
  if (!input) return;

  const dir = stateDir({ sessionId: input.session_id, namespace: STATE_NAMESPACE });
  trackSessionChanges({
    input,
    listFile: path.join(dir, TOUCHED_FILES),
    matches: (absPath) => isPythonFile(absPath) && !isIgnoredPath(absPath),
  });
}

main();
