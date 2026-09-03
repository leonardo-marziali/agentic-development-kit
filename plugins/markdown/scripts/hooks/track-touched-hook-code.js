#!/usr/bin/env node
'use strict';

/*
PostToolUse hook (Edit|Write matcher): records every .js file this session
creates or edits under this plugin's own scripts/hooks/ directory — the
hook implementation and its test suite. verify-tests.js reads this list on
Stop/SubagentStop so `npm test` only ever runs in response to hook source
this session actually touched, not on every unrelated Edit/Write.
*/

const fs = require('node:fs');
const path = require('node:path');
const { stateDir } = require('./lib');

// This script's own directory *is* the scope: everything under it
// (lib.js, the other hooks, __tests__/) is what the plugin's test suite
// covers.
const HOOKS_DIR = __dirname;

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    return;
  }

  if (!/^(Edit|Write)$/.test(input.tool_name || '')) return;

  const filePath = input.tool_input?.file_path;
  if (!filePath || !/\.js$/i.test(filePath)) return;

  const cwd = input.cwd || process.cwd();
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  if (!fs.existsSync(absPath)) return;
  if (!absPath.startsWith(HOOKS_DIR + path.sep)) return;

  const dir = stateDir(input.session_id);
  fs.mkdirSync(dir, { recursive: true });

  const listFile = path.join(dir, 'touched-hook-code.txt');
  let existing = [];
  if (fs.existsSync(listFile)) {
    existing = fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean);
  }
  if (!existing.includes(absPath)) {
    fs.appendFileSync(listFile, absPath + '\n');
  }
}

main();
