#!/usr/bin/env node
'use strict';

/*
 * PreToolUse / PostToolUse / PostToolUseFailure hook: records every file this session
 * creates or edits, so the Stop/SubagentStop hooks only ever analyse files
 * this session actually touched — never pre-existing code the user didn't ask
 * us to police, and never a whole-project scan on every turn.
 */

const path = require('node:path');
const {
  readHookInput,
  stateDir,
  guardCommit,
  trackSessionChanges,
} = require('@leonardo-marziali/ad-lfl-kit');
const { STATE_NAMESPACE, TOUCHED_FILES, isAnalyzable } = require('./lib');

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
  if (guardCommit({ input, listFile, matches: isAnalyzable, label: 'sonarqube plugin' }).denied)
    return;
  trackSessionChanges({ input, listFile, matches: isAnalyzable });
}

main();
