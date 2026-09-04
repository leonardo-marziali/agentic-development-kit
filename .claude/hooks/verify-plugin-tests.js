#!/usr/bin/env node
'use strict';

/*
Stop / SubagentStop hook for this repository's own development,
registered from .claude/settings.json — not shipped in any plugin.

If this session edited any plugin's hook source or tests (tracked by
track-touched-hook-code.js), runs that plugin's test suite and blocks the
stop with decision:"continue" until it passes — so a change to a plugin's
hooks can't ship without the suite actually having been run against it in
this session.

Each touched file resolves to its own plugin root, so a session that
edits two plugins runs both suites and nothing else. Capped at
MAX_ATTEMPTS so a failure nothing can resolve can't loop forever; there's
no mechanical fallback for a broken test, so hitting the cap just stops
blocking, it doesn't silence the failure.
*/

const fs = require('node:fs');
const path = require('node:path');
const {
  stateDir,
  readHookInput,
  pluginRootForHookSource,
  readTrackedFiles,
  readAttempts,
  cleanup,
  runBin,
} = require('./lib');

const MAX_ATTEMPTS = 3;
const OWN_STATE_FILES = ['touched-hook-code.txt', 'test-attempts.json'];

function main() {
  const input = readHookInput();
  if (!input) return;

  const hookEventName = input.hook_event_name || 'Stop';
  const dir = stateDir(input.session_id);
  const listFile = path.join(dir, 'touched-hook-code.txt');

  if (!fs.existsSync(listFile)) return;

  const pluginRoots = [
    ...new Set(readTrackedFiles(listFile).map(pluginRootForHookSource).filter(Boolean)),
  ].sort();

  if (pluginRoots.length === 0) {
    cleanup(dir, OWN_STATE_FILES);
    return;
  }

  const attemptsFile = path.join(dir, 'test-attempts.json');
  const attempts = readAttempts(attemptsFile);

  const failures = [];
  for (const pluginRoot of pluginRoots) {
    let result;
    try {
      result = runBin('pnpm', ['test'], { cwd: pluginRoot, encoding: 'utf8' });
    } catch (err) {
      process.stderr.write(
        `repo hooks: pnpm test invocation failed in ${pluginRoot}: ${err.message}\n`,
      );
      return;
    }
    if (result.status !== 0) {
      const output = ((result.stdout || '') + (result.stderr || '')).trim();
      failures.push({ pluginRoot, output });
    }
  }

  if (failures.length === 0) {
    cleanup(dir, OWN_STATE_FILES);
    return;
  }

  const report = failures.map((f) => `--- ${f.pluginRoot} ---\n${f.output}`).join('\n\n');

  if (attempts >= MAX_ATTEMPTS) {
    process.stderr.write(
      `repo hooks: plugin tests still failing after ${MAX_ATTEMPTS} attempts for hook source ` +
        `edited this session; giving up for this session.\n${report}\n`,
    );
    cleanup(dir, OWN_STATE_FILES);
    return;
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(attemptsFile, JSON.stringify({ count: attempts + 1 }));

  const plural = failures.length === 1 ? 'suite' : 'suites';
  const output = {
    hookSpecificOutput: {
      hookEventName,
      decision: 'continue',
      systemMessage:
        `This session edited hook source or tests under ${pluginRoots.join(', ')}, and ` +
        `${failures.length} test ${plural} ${failures.length === 1 ? 'is' : 'are'} failing ` +
        `(attempt ${attempts + 1}/${MAX_ATTEMPTS}):\n\n${report}\n\n` +
        'Fix the failure(s) and make sure `pnpm test` passes in each affected plugin ' +
        'directory before finishing.',
    },
  };

  process.stdout.write(JSON.stringify(output));
}

main();
