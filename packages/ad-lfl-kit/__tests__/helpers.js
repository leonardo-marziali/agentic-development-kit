'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

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

module.exports = { mkScratchDir, rmScratchDir, uniqueSessionId, writeFile };
