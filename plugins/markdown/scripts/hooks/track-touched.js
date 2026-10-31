#!/usr/bin/env node
'use strict';

/*
PostToolUse hook on Edit/Write/MultiEdit/NotebookEdit: records each markdown
file Claude itself writes, so the Stop/SubagentStop hooks only ever lint
those files — never pre-existing markdown.

Files changed through Bash, PowerShell or MCP tools are deliberately not
tracked. Those tools don't say what they wrote, so the only way to find out
is to diff the workspace around the call, and that also picks up files the
session didn't author: a `git pull` bringing in a release bot's regenerated
CHANGELOG.md, a formatter or code generator rewriting files nobody asked to
own. Markdown is almost always written with Edit/Write, and anything else
can still be linted on demand with /markdown:lint.
*/

const path = require('node:path');
const { readHookInput, stateDir, trackTouchedFile } = require('@leonardo-marziali/ad-lfl-kit');
const { STATE_NAMESPACE, TOUCHED_FILES, isMarkdownFile } = require('./lib');

function main() {
  const input = readHookInput();
  if (!input) return;

  const dir = stateDir({ sessionId: input.session_id, namespace: STATE_NAMESPACE });
  trackTouchedFile({ input, listFile: path.join(dir, TOUCHED_FILES), matches: isMarkdownFile });
}

main();
