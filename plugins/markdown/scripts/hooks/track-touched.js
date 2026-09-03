#!/usr/bin/env node
'use strict';

/*
PostToolUse hook (Edit|Write matcher): records every markdown file this
session creates or edits, so the Stop/SubagentStop hooks only ever lint
files this session actually touched — never pre-existing markdown.
*/

const fs = require('node:fs');
const path = require('node:path');
const { stateDir } = require('./lib');

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
  if (!filePath || !/\.md$/i.test(filePath)) return;

  const cwd = input.cwd || process.cwd();
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  if (!fs.existsSync(absPath)) return;

  const dir = stateDir(input.session_id);
  fs.mkdirSync(dir, { recursive: true });

  const listFile = path.join(dir, 'touched-files.txt');
  let existing = [];
  if (fs.existsSync(listFile)) {
    existing = fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean);
  }
  if (!existing.includes(absPath)) {
    fs.appendFileSync(listFile, absPath + '\n');
  }
}

main();
