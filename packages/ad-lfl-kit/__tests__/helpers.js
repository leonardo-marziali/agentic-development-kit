'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

function mkScratchDir(prefix = 'ad-lfl-kit-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmScratchDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

function uniqueSessionId() {
  return `test-${crypto.randomUUID()}`;
}

/*
 * Writes a file into the scratch dir and returns its absolute path, so tests
 * can hand runFixLoop and trackTouchedFile paths that actually exist — both
 * filter out files that don't.
 */
function writeFile(dir, name, contents = 'x') {
  const full = path.join(dir, name);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

/*
 * A throwaway git repo with `files` committed, for the scope tests.
 *
 * Identity and commit signing are passed per-invocation rather than read from
 * the environment: the suite must behave the same on a machine with no global
 * git config as on a developer's, and must never be derailed by a repo
 * template or a commit hook.
 */
function mkScratchRepo(files = {}) {
  const dir = fs.realpathSync(mkScratchDir('ad-lfl-kit-repo-'));
  const run = (...args) =>
    execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe', encoding: 'utf8' });

  run('init', '--quiet', '--initial-branch=main');
  for (const [name, contents] of Object.entries(files)) writeFile(dir, name, contents);
  run('add', '--all');
  run(
    '-c',
    'user.email=test@example.com',
    '-c',
    'user.name=Test',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '--no-verify',
    '-m',
    'initial',
  );

  return dir;
}

module.exports = { mkScratchDir, rmScratchDir, uniqueSessionId, writeFile, mkScratchRepo };
