'use strict';

const fs = require('node:fs');

/*
 * Claude Code delivers the hook payload on stdin. Reading fd 0 throws when
 * there's nothing attached (a hook invoked by hand, some test harnesses), and
 * a hook that crashes on startup is worse than one that does nothing, so
 * failure reads as "no input".
 */
function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/*
 * Returns the parsed hook payload, or null when stdin held nothing parseable.
 * Callers treat null as "not enough information to act" and return quietly.
 */
function readHookInput() {
  try {
    return JSON.parse(readStdin() || '{}');
  } catch {
    return null;
  }
}

module.exports = { readStdin, readHookInput };
