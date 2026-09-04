'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/*
Locates a node-adjacent CLI shim (npx). Hooks don't inherit a login
shell, so PATH can be missing the Node toolchain entirely; looking beside
process.execPath is the reliable first guess. But the shim is only bare
`npx` on POSIX — on Windows it's `npx.cmd` — and it isn't always
installed next to the node binary (system package managers, some version
managers). So probe the real candidates, and fall back to a bare name for
PATH lookup.
*/
function resolveBin(name) {
  const dir = path.dirname(process.execPath);
  const candidates = process.platform === 'win32' ? [`${name}.cmd`, `${name}.exe`, name] : [name];
  for (const candidate of candidates) {
    const full = path.join(dir, candidate);
    if (fs.existsSync(full)) return full;
  }
  return candidates[0];
}

/*
cmd.exe consumes the argument string itself, and spawnSync only
space-joins argv when shell:true — so quote each argument here. Runs of
backslashes before a quote (and at the very end) are doubled first, since
cmd.exe would otherwise treat them as escaping the quote.
*/
function quoteForCmd(arg) {
  const value = String(arg)
    .replace(/(\\*)"/g, '$1$1""')
    .replace(/(\\+)$/, '$1$1');
  return `"${value}"`;
}

/*
Runs a node-adjacent CLI shim. On Windows the shim is a .cmd batch file,
which Node refuses to spawn without a shell, so route through one there
(with arguments quoted by hand); everywhere else spawn argv directly, so
no shell ever parses a file path.
*/
function runBin(name, args, options) {
  const bin = resolveBin(name);
  if (process.platform === 'win32') {
    return spawnSync(quoteForCmd(bin), args.map(quoteForCmd), {
      ...options,
      shell: true,
      windowsVerbatimArguments: true,
    });
  }
  return spawnSync(bin, args, options);
}

module.exports = { resolveBin, quoteForCmd, runBin };
