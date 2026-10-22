#!/usr/bin/env node
'use strict';

/*
PostToolUse hook (Edit|Write matcher): records every Python file this
session creates or edits, so the Stop/SubagentStop hooks only ever check
files this session actually touched — never pre-existing code.
*/

const path = require('node:path');
const { readHookInput, stateDir, trackTouchedFile } = require('@leonardo-marziali/ad-lfl-kit');
const { STATE_NAMESPACE, TOUCHED_FILES, isPythonFile, isIgnoredPath } = require('./lib');

function main() {
  const input = readHookInput();
  if (!input) return;

  const dir = stateDir({ sessionId: input.session_id, namespace: STATE_NAMESPACE });
  trackTouchedFile({
    input,
    listFile: path.join(dir, TOUCHED_FILES),
    matches: (absPath) => isPythonFile(absPath) && !isIgnoredPath(absPath),
  });
}

main();
