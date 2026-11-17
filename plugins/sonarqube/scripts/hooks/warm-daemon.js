#!/usr/bin/env node
'use strict';

/*
 * SessionStart hook: makes sure the pinned SLOOP engine is installed, then
 * starts this project's analysis daemon in the background, with a warm-up
 * pass, so the JVM and analyzer start-up (~20s) is paid before the first
 * edit rather than inside it. The per-edit feedback hook only ever uses a
 * daemon that is already running.
 *
 * The first session after the plugin is installed (or updated to a new pin)
 * downloads ~160-210 MB from Maven Central, or SONARLINT_ARTIFACT_BASE_URL.
 * The hook is async, so the session doesn't wait for it. A failure is
 * recorded for `sonarlint doctor` and retried at the next session start;
 * the Stop hook says so when it can't analyze.
 */

const { readHookInput } = require('@leonardo-marziali/ad-lfl-kit');
const { ensureInstalled } = require('../../cli/provision');
const { dataDir } = require('../../cli/paths');
const { runSonarlint } = require('./lib');

async function main() {
  const input = readHookInput();
  if (!input) return;
  // SONARLINT_CLI points at a stand-in CLI (tests); there is nothing to install.
  if (!process.env.SONARLINT_CLI) {
    const { status } = await ensureInstalled({ dataDir: dataDir() });
    if (status === 'busy') return; // another session is installing; it will warm up next time
  }
  runSonarlint(['daemon', 'start'], { cwd: input.cwd || process.cwd(), timeoutMs: 40_000 });
}

main().catch((error) => {
  process.stderr.write(
    `sonarqube: could not install the local analysis engine: ${error.message}\n`,
  );
});
