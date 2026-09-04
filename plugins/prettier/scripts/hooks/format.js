#!/usr/bin/env node
'use strict';

/*
PostToolUse hook (Edit|Write matcher): formats the exact file just touched
with Prettier, immediately. Unlike the markdown plugin's session-scoped
lint loop, there's no state to track and nothing to loop on — Prettier
either formats a file or leaves it alone.
*/

const fs = require('node:fs');
const path = require('node:path');
const { runBin } = require('./lib');

const IGNORED_DIR_SEGMENTS = [`${path.sep}node_modules${path.sep}`, `${path.sep}.git${path.sep}`];

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function isIgnoredPath(absPath) {
  const withTrailingSep = absPath + path.sep;
  return IGNORED_DIR_SEGMENTS.some((segment) => withTrailingSep.includes(segment));
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
  if (!filePath) return;

  const cwd = input.cwd || process.cwd();
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  if (!fs.existsSync(absPath)) return;
  if (isIgnoredPath(absPath)) return;

  let result;
  try {
    result = runBin('npx', ['-y', 'prettier', '--write', '--ignore-unknown', absPath], {
      cwd,
      encoding: 'utf8',
    });
  } catch (err) {
    process.stderr.write(`prettier plugin: invocation failed: ${err.message}\n`);
    return;
  }

  if (result.status !== 0) {
    const output = ((result.stdout || '') + (result.stderr || '')).trim();
    process.stderr.write(`prettier plugin: formatting ${absPath} failed:\n${output}\n`);
  }
}

main();
