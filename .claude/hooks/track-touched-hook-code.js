#!/usr/bin/env node
'use strict';

/*
PostToolUse hook (Edit|Write matcher) for this repository's own
development, registered from .claude/settings.json — not shipped in any
plugin.

Records every .js file this session creates or edits under any plugin's
scripts/hooks/ directory (hook implementations and their test suites).
verify-plugin-tests.js reads this list on Stop/SubagentStop so a test run
only happens in response to hook source this session actually touched,
not on every unrelated Edit/Write.
*/

const fs = require('node:fs');
const path = require('node:path');
const { stateDir, readHookInput, pluginRootForHookSource, appendTrackedFile } = require('./lib');

function main() {
  const input = readHookInput();
  if (!input) return;

  if (!/^(Edit|Write)$/.test(input.tool_name || '')) return;

  const filePath = input.tool_input?.file_path;
  if (!filePath) return;

  const cwd = input.cwd || process.cwd();
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  if (!fs.existsSync(absPath)) return;
  if (!pluginRootForHookSource(absPath)) return;

  const dir = stateDir(input.session_id);
  fs.mkdirSync(dir, { recursive: true });
  appendTrackedFile(path.join(dir, 'touched-hook-code.txt'), absPath);
}

main();
