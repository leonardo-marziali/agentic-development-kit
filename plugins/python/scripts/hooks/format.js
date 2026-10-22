#!/usr/bin/env node
'use strict';

/*
PostToolUse hook (Edit|Write matcher): formats the exact Python file just
touched with `ruff format`, immediately — the same shape as the prettier
plugin's hook. Lint findings are left to the Stop-hook loop
(check-and-loop.js); formatting either applies or it doesn't, so there is
nothing to loop on here.

Ruff discovers pyproject.toml / ruff.toml per file by itself, and
--force-exclude makes the project's `exclude` apply even though the file
is passed explicitly.
*/

const fs = require('node:fs');
const path = require('node:path');
const { readHookInput, runBin } = require('@leonardo-marziali/ad-lfl-kit');
const { isPythonFile, isIgnoredPath, resolveTool } = require('./lib');

function main() {
  const input = readHookInput();
  if (!input) return;

  if (!/^(Edit|Write)$/.test(input.tool_name || '')) return;

  const filePath = input.tool_input?.file_path;
  if (!filePath) return;

  const cwd = input.cwd || process.cwd();
  const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
  if (!isPythonFile(absPath)) return;
  if (!fs.existsSync(absPath)) return;
  if (isIgnoredPath(absPath)) return;

  const ruff = resolveTool('ruff', { fromDir: path.dirname(absPath) });
  if (!ruff) {
    process.stderr.write(
      'python plugin: ruff not found (no .venv, PATH or uvx); skipping format-on-edit.\n',
    );
    return;
  }

  let result;
  try {
    result = runBin(ruff.name, [...ruff.prefix, 'format', '--force-exclude', absPath], {
      cwd,
      encoding: 'utf8',
      extraDirs: ruff.extraDirs,
    });
  } catch (err) {
    process.stderr.write(`python plugin: ruff format invocation failed: ${err.message}\n`);
    return;
  }

  if (result.error) {
    process.stderr.write(`python plugin: ruff format invocation failed: ${result.error.message}\n`);
    return;
  }
  if (result.status !== 0) {
    const output = ((result.stdout || '') + (result.stderr || '')).trim();
    process.stderr.write(`python plugin: formatting ${absPath} failed:\n${output}\n`);
  }
}

main();
