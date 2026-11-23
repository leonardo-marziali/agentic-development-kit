#!/usr/bin/env node
'use strict';

/*
PostToolUse hook (Edit|Write|MultiEdit matcher): formats the exact Python file just
touched with `ruff format`, immediately — the same shape as the prettier
plugin's hook. Lint findings are left to the Stop-hook loop
(check-and-loop.js); formatting either applies or it doesn't, so there is
nothing to loop on here.

Inside a git repo only ruff's changes on or near the lines that differ from
the session base are written, so an edit to an unformatted file doesn't
reformat all of it (see formatWithRuff in lib.js). Outside a repo, for an
untracked file, or with the plugin's `whole_files` option on, the whole
file is formatted.

Ruff discovers pyproject.toml / ruff.toml per file by itself, and
--force-exclude makes the project's `exclude` apply even though the file
is passed explicitly.
*/

const fs = require('node:fs');
const path = require('node:path');
const { readHookInput, stateDir, readSessionBases } = require('@leonardo-marziali/ad-lfl-kit');
const {
  STATE_NAMESPACE,
  isPythonFile,
  isIgnoredPath,
  resolveTool,
  wholeFilesEnabled,
  formatWithRuff,
} = require('./lib');

function main() {
  const input = readHookInput();
  if (!input) return;

  if (!/^(Edit|Write|MultiEdit)$/.test(input.tool_name || '')) return;

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
    result = formatWithRuff(ruff, absPath, {
      bases: readSessionBases(
        stateDir({ sessionId: input.session_id, namespace: STATE_NAMESPACE }),
      ),
      wholeFile: wholeFilesEnabled(),
    });
  } catch (err) {
    process.stderr.write(`python plugin: ruff format invocation failed: ${err.message}\n`);
    return;
  }

  if (!result.ok) {
    process.stderr.write(`python plugin: formatting ${absPath} failed:\n${result.output}\n`);
  }
}

main();
