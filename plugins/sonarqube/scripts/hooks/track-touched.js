#!/usr/bin/env node
'use strict';

/*
 * PostToolUse hook (Edit|Write matcher): records every file this session
 * creates or edits, so the Stop/SubagentStop hooks only ever analyse files
 * this session actually touched — never pre-existing code the user didn't ask
 * us to police, and never a whole-project scan on every turn.
 */

const path = require('node:path');
const { readHookInput, stateDir, trackTouchedFile } = require('@leonardo-marziali/ad-lfl-kit');
const { STATE_NAMESPACE, TOUCHED_FILES, isAnalyzable } = require('./lib');

function main() {
  const input = readHookInput();
  if (!input) return;

  const dir = stateDir({ sessionId: input.session_id, namespace: STATE_NAMESPACE });
  trackTouchedFile({ input, listFile: path.join(dir, TOUCHED_FILES), matches: isAnalyzable });
}

main();
