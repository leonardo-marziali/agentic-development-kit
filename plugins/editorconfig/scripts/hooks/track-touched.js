#!/usr/bin/env node
'use strict';

/*
PreToolUse / PostToolUse / PostToolUseFailure hook: records every file this
session creates or edits, so the Stop/SubagentStop hooks only ever enforce
EditorConfig on files this session actually touched.
*/

const path = require('node:path');
const { readHookInput, stateDir, trackSessionChanges } = require('@leonardo-marziali/ad-lfl-kit');
const { STATE_NAMESPACE, TOUCHED_FILES, isEnforceable } = require('./lib');

function main() {
  const input = readHookInput();
  if (!input) return;

  const dir = stateDir({ sessionId: input.session_id, namespace: STATE_NAMESPACE });
  trackSessionChanges({ input, listFile: path.join(dir, TOUCHED_FILES), matches: isEnforceable });
}

main();
