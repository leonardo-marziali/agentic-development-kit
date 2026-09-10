'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/*
 * Locates a CLI shim across platforms.
 *
 * Hooks don't inherit a login shell, so PATH can be missing the toolchain
 * entirely; looking beside process.execPath is the reliable first guess for
 * anything installed alongside node (npx, npm). But the shim is only a bare
 * name on POSIX — on Windows it's `<name>.cmd` — and it isn't always installed
 * next to the node binary (system package managers, some version managers).
 * So probe the real candidates, and fall back to a bare name for PATH lookup.
 *
 * `extraDirs` covers binaries that are never node-adjacent — a CLI installed
 * by Homebrew or mise, say. Callers that pass nothing behave exactly as they
 * did before the option existed.
 */
function resolveBin(name, options = {}) {
  const { extraDirs = [] } = options;
  const dirs = [path.dirname(process.execPath), ...extraDirs];
  const candidates = process.platform === 'win32' ? [`${name}.cmd`, `${name}.exe`, name] : [name];

  for (const dir of dirs) {
    if (!dir) continue;
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      if (fs.existsSync(full)) return full;
    }
  }
  return candidates[0];
}

/*
 * cmd.exe consumes the argument string itself, and spawnSync only space-joins
 * argv when shell:true — so quote each argument here. Runs of backslashes
 * before a quote (and at the very end) are doubled first, since cmd.exe would
 * otherwise treat them as escaping the quote.
 */
function quoteForCmd(arg) {
  const value = String(arg)
    .replace(/(\\*)"/g, '$1$1""')
    .replace(/(\\+)$/, '$1$1');
  return `"${value}"`;
}

/*
 * Runs a CLI shim. On Windows the shim is a .cmd batch file, which Node
 * refuses to spawn without a shell, so route through one there (with
 * arguments quoted by hand); everywhere else spawn argv directly, so no shell
 * ever parses a file path.
 */
function runBin(name, args, options = {}) {
  const { extraDirs, ...spawnOptions } = options;
  const bin = resolveBin(name, { extraDirs });

  if (process.platform === 'win32') {
    return spawnSync(quoteForCmd(bin), args.map(quoteForCmd), {
      ...spawnOptions,
      shell: true,
      windowsVerbatimArguments: true,
    });
  }
  return spawnSync(bin, args, spawnOptions);
}

module.exports = { resolveBin, quoteForCmd, runBin };
