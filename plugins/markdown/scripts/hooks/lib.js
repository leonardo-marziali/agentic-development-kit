'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/*
Session-scoped directory for tracking which markdown files this plugin
has touched. Prefers the plugin's own data dir; falls back to tmp so the
hooks still work if CLAUDE_PLUGIN_DATA isn't set.
*/
function stateDir(sessionId) {
  const base = process.env.CLAUDE_PLUGIN_DATA
    ? path.join(process.env.CLAUDE_PLUGIN_DATA, 'markdown-session-scope')
    : path.join(os.tmpdir(), 'claude-markdown-plugin');
  return path.join(base, sessionId || 'unknown-session');
}

const CONFIG_NAMES = [
  '.markdownlint.jsonc',
  '.markdownlint.json',
  '.markdownlint.yaml',
  '.markdownlint.yml',
];

/*
markdownlint-cli only resolves config files relative to its own process
cwd — it does NOT walk up from, or check the directory of, the files it
lints. To respect the nearest .markdownlint.* to each file (including in
a monorepo), we have to do that walk ourselves and invoke the CLI once
per resolved directory, with cwd set there.
*/
function resolveConfigDir(filePath) {
  let dir = path.dirname(path.resolve(filePath));
  const root = path.parse(dir).root;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (CONFIG_NAMES.some((name) => fs.existsSync(path.join(dir, name)))) {
      return dir;
    }
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  /*
  No config found anywhere above the file: cwd doesn't matter, use the
  file's own directory.
  */
  return path.dirname(path.resolve(filePath));
}

function groupByConfigDir(files) {
  const groups = new Map();
  for (const file of files) {
    const dir = resolveConfigDir(file);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(file);
  }
  return groups;
}

module.exports = { stateDir, resolveConfigDir, groupByConfigDir };
