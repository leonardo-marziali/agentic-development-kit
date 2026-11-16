#!/usr/bin/env node
'use strict';

/*
PreToolUse / PostToolUse / PostToolUseFailure hook: records every Java and
build file this session creates or edits, so the Stop/SubagentStop hooks
only ever check files this session actually touched.

Edit-family tools name their file; for Bash, PowerShell and MCP tools,
which don't, PreToolUse snapshots the workspace and the Post* event
tracks whatever changed since (see ad-lfl-kit's trackSessionChanges).
*/

const path = require('node:path');
const {
  readHookInput,
  stateDir,
  guardCommit,
  trackSessionChanges,
} = require('@leonardo-marziali/ad-lfl-kit');
const { STATE_NAMESPACE, TOUCHED_FILES, isTrackable } = require('./lib');

function main() {
  const input = readHookInput();
  if (!input) return;

  const dir = stateDir({ sessionId: input.session_id, namespace: STATE_NAMESPACE });
  const listFile = path.join(dir, TOUCHED_FILES);
  /*
   * A commit while touched files are still waiting on the Stop hook would put
   * unchecked work into history, so it is denied until that hook has run. A
   * denied call never runs, so there is nothing to track for it either.
   */
  if (guardCommit({ input, listFile, matches: isTrackable, label: 'java plugin' }).denied) return;
  trackSessionChanges({ input, listFile, matches: isTrackable });
}

main();
