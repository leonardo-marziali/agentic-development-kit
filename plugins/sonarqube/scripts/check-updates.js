#!/usr/bin/env node
'use strict';

/*
 * Compares every pin in sloop.lock.json with the newest version Maven
 * Central's metadata lists, and prints the difference. It never edits the
 * lock: a bump is a deliberate, tested change — update the version, re-pin
 * the sha256 from a verified download, run the integration test.
 *
 *   node scripts/check-updates.js
 *
 * Honours SONARLINT_ARTIFACT_BASE_URL like install-sloop.js. Exit 0 always
 * unless metadata can't be fetched (2).
 */

const { loadLock, baseUrlFromEnv } = require('../cli/provision');

function latestFrom(xml) {
  const release = /<release>([^<]+)<\/release>/.exec(xml);
  if (release) return release[1];
  const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
  return versions[versions.length - 1] || null;
}

async function latestVersion(baseUrl, { groupId, artifactId }) {
  const url = `${baseUrl.replace(/\/+$/, '')}/${groupId.replace(/\./g, '/')}/${artifactId}/maven-metadata.xml`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return latestFrom(await response.text());
}

async function main() {
  const lock = loadLock();
  const baseUrl = baseUrlFromEnv();
  const entries = [lock.backend, ...lock.analyzers];
  let outdated = 0;
  for (const entry of entries) {
    const latest = await latestVersion(baseUrl, entry);
    const same = latest === entry.version;
    if (!same) outdated += 1;
    process.stdout.write(
      `${same ? '=' : '↑'} ${entry.artifactId}: ${entry.version}${same ? '' : ` → ${latest}`}\n`,
    );
  }
  process.stdout.write(
    outdated
      ? `${outdated} pin(s) behind. Bump them in sloop.lock.json, re-pin each sha256, and run the integration test.\n`
      : 'all pins are current.\n',
  );
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`check-updates: ${error.message}\n`);
    process.exit(2);
  });
}

module.exports = { latestFrom };
