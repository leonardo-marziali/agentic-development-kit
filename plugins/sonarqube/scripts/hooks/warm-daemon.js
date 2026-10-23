#!/usr/bin/env node
'use strict';

/*
 * SessionStart hook: starts this project's analysis daemon in the
 * background, with a warm-up pass, so the JVM and analyzer start-up (~20s)
 * is paid before the first edit rather than inside it. The per-edit
 * feedback hook only ever uses a daemon that is already running.
 *
 * Silent no-op when SLOOP isn't installed: nagging at every session start
 * about an optional tool is noise. /sonarqube:setup installs it, and the
 * Stop hook says so when it can't analyze.
 */

const { readHookInput } = require('@leonardo-marziali/ad-lfl-kit');
const { readInstall } = require('../../cli/provision');
const { dataDir } = require('../../cli/paths');
const { runSonarlint } = require('./lib');

function main() {
  const input = readHookInput();
  if (!input) return;
  if (!process.env.SONARLINT_CLI && !readInstall(dataDir())) return;
  runSonarlint(['daemon', 'start'], { cwd: input.cwd || process.cwd(), timeoutMs: 40_000 });
}

main();
