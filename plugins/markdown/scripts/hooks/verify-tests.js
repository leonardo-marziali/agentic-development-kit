#!/usr/bin/env node
'use strict';

/*
Stop / SubagentStop hook: if this session edited this plugin's own hook
source or tests (tracked by track-touched-hook-code.js), runs `npm test`
for this plugin and blocks the stop with decision:"continue" until it
passes — so a change to the hooks can't ship without the suite actually
having been run against it in this session. Capped at MAX_ATTEMPTS so a
failure nothing can resolve can't loop forever; unlike the markdownlint
loop, there's no mechanical fallback for a broken test — giving up here
just stops blocking, it doesn't silence the failure.

MARKDOWN_PLUGIN_TEST_ROOT overrides which directory `npm test` runs in;
only meant for this hook's own test suite, so it can point at a throwaway
fixture package instead of recursively re-running the real plugin suite.
*/

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { stateDir } = require('./lib');

const MAX_ATTEMPTS = 3;
const NPM_PATH = path.join(path.dirname(process.execPath), 'npm');
const PLUGIN_ROOT = process.env.MARKDOWN_PLUGIN_TEST_ROOT || path.resolve(__dirname, '..', '..');

/*
Shares the session state directory with check-and-loop.js — only touch
 * the files this hook owns, then drop the directory if that leaves it
 * empty.
*/
const OWN_STATE_FILES = ['touched-hook-code.txt', 'test-attempts.json'];

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function cleanup(dir) {
  for (const name of OWN_STATE_FILES) {
    try {
      fs.rmSync(path.join(dir, name), { force: true });
    } catch {
      // best effort
    }
  }
  try {
    fs.rmdirSync(dir);
  } catch {
    // not empty (other hook's state still pending) or already gone
  }
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    return;
  }

  const hookEventName = input.hook_event_name || 'Stop';
  const dir = stateDir(input.session_id);
  const listFile = path.join(dir, 'touched-hook-code.txt');

  if (!fs.existsSync(listFile)) return;

  const files = [...new Set(fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean))].filter(
    (f) => fs.existsSync(f),
  );

  if (files.length === 0) {
    cleanup(dir);
    return;
  }

  const attemptsFile = path.join(dir, 'test-attempts.json');
  let attempts = 0;
  if (fs.existsSync(attemptsFile)) {
    try {
      attempts = JSON.parse(fs.readFileSync(attemptsFile, 'utf8')).count || 0;
    } catch {
      attempts = 0;
    }
  }

  let result;
  try {
    result = spawnSync(NPM_PATH, ['test'], {
      cwd: PLUGIN_ROOT,
      encoding: 'utf8',
    });
  } catch (err) {
    process.stderr.write(`markdown plugin: npm test invocation failed: ${err.message}\n`);
    return;
  }

  if (result.status === 0) {
    cleanup(dir);
    return;
  }

  const output = ((result.stdout || '') + (result.stderr || '')).trim();

  if (attempts >= MAX_ATTEMPTS) {
    process.stderr.write(
      `markdown plugin: npm test still failing after ${MAX_ATTEMPTS} attempts for hook source ` +
        `edited this session; giving up for this session.\n${output}\n`,
    );
    cleanup(dir);
    return;
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(attemptsFile, JSON.stringify({ count: attempts + 1 }));

  const hookOutput = {
    hookSpecificOutput: {
      hookEventName,
      decision: 'continue',
      stopReason: "npm test is failing for this plugin's hook source, edited this session.",
      systemMessage:
        'This session edited plugins/markdown/scripts/hooks/ source or tests, and `npm test` ' +
        `is failing (attempt ${attempts + 1}/${MAX_ATTEMPTS}):\n\n${output}\n\n` +
        'Fix the failure(s) and make sure `npm test` (run from plugins/markdown) passes before finishing.',
    },
  };

  process.stdout.write(JSON.stringify(hookOutput));
}

main();
