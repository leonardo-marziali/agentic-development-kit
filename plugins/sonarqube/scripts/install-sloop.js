#!/usr/bin/env node
'use strict';

/*
 * Installs the pinned SLOOP backend and analyzer jars (sloop.lock.json) into
 * the plugin's data dir. Run by the /sonarqube:setup skill; safe to re-run —
 * artifacts already present with the right checksum are kept.
 *
 *   node scripts/install-sloop.js [--data-dir <dir>] [--from-dir <dir>] [--no-arch]
 *
 * SONARLINT_ARTIFACT_BASE_URL points downloads at a Maven mirror (Artifactory,
 * Nexus) instead of Maven Central. --from-dir installs offline from a
 * directory holding the artifacts under their Maven file names.
 *
 * Exit codes: 0 installed, 2 failed (nothing half-installed is left active).
 */

const { install } = require('../cli/provision');
const { dataDir: resolveDataDir } = require('../cli/paths');

function parse(argv) {
  const options = { dataDir: null, fromDir: null, noArch: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--data-dir') options.dataDir = argv[++i];
    else if (arg === '--from-dir') options.fromDir = argv[++i];
    else if (arg === '--no-arch') options.noArch = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

async function main() {
  const options = parse(process.argv.slice(2));
  const dataDir = resolveDataDir(options.dataDir);
  process.stdout.write(`installing SLOOP into ${dataDir}\n`);
  const manifest = await install({
    dataDir,
    fromDir: options.fromDir,
    ...(options.noArch ? { distributionKey: 'no-arch' } : {}),
    log: (line) => process.stdout.write(`  ${line}\n`),
  });
  process.stdout.write(
    `installed sonarlint-backend-cli ${manifest.backendVersion} (${manifest.distribution}, ` +
      `${manifest.bundledJre ? 'bundled JRE' : `system Java: ${manifest.javaPath}`}) ` +
      `with ${manifest.analyzers.length} analyzers\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`install-sloop: ${error.message}\n`);
  process.exit(2);
});
