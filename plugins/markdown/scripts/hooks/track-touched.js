#!/usr/bin/env node
'use strict';

/*
PreToolUse / PostToolUse / PostToolUseFailure hook: records every markdown file this
session creates or edits, so the Stop/SubagentStop hooks only ever lint
files this session actually touched — never pre-existing markdown.
*/

const path = require('node:path');
const { readHookInput, stateDir, trackSessionChanges } = require('@leonardo-marziali/ad-lfl-kit');
const { STATE_NAMESPACE, TOUCHED_FILES, isMarkdownFile } = require('./lib');

function main() {
  const input = readHookInput();
  if (!input) return;

  const dir = stateDir({ sessionId: input.session_id, namespace: STATE_NAMESPACE });
  trackSessionChanges({ input, listFile: path.join(dir, TOUCHED_FILES), matches: isMarkdownFile });
}

main();
