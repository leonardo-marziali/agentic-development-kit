#!/usr/bin/env node
'use strict';

/*
 * Installs the pinned jars (engine.lock.json) into the plugin's data dir and
 * compiles the engine's Java sources. Run by /java:setup and, with
 * --if-missing --quiet, asynchronously at SessionStart; safe to re-run.
 *
 *   node scripts/install-engine.js [--data-dir <dir>] [--from-dir <dir>]
 *                                  [--if-missing] [--quiet]
 *
 * JAVA_PLUGIN_ARTIFACT_BASE_URL points downloads at a Maven mirror; --from-dir
 * installs offline from a directory holding the jars under their Maven names.
 *
 * Exit codes: 0 installed (or already current), 2 failed.
 */

const { install, readInstall, engineDataDir } = require('./provision');

function parse(argv) {
  const options = { dataDir: null, fromDir: null, ifMissing: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--data-dir') options.dataDir = argv[++i];
    else if (arg === '--from-dir') options.fromDir = argv[++i];
    else if (arg === '--if-missing') options.ifMissing = true;
    else if (arg === '--quiet') options.quiet = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

async function main() {
  const options = parse(process.argv.slice(2));
  const dataDir = options.dataDir || engineDataDir();
  if (options.ifMissing && readInstall(dataDir)) return;

  const log = options.quiet ? () => {} : (line) => process.stdout.write(`${line}\n`);
  log(`installing the java plugin's engine into ${dataDir}`);
  const manifest = await install({ dataDir, fromDir: options.fromDir, log });
  log(`installed: JDK ${manifest.javaMajor} at ${manifest.javaBin}`);
}

main().catch((err) => {
  process.stderr.write(`java plugin: engine install failed: ${err.message}\n`);
  process.exit(2);
});
