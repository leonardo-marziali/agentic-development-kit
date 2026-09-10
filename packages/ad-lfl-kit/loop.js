'use strict';

const path = require('node:path');
const { readAttempts, writeAttempts, cleanup } = require('./state');

const DEFAULT_MAX_ATTEMPTS = 3;

/*
 * The Stop/SubagentStop half of the loop: check the files this session
 * touched, and if they don't pass, block the stop with decision:"continue" so
 * Claude is handed the failures and keeps working.
 *
 * The loop is capped so it can't run forever. Hitting the cap is not success —
 * `onCap` gets the last report so the caller can say what it's giving up on
 * (and, if it has a safe mechanical fallback, apply it) before the stop is
 * allowed through.
 *
 * Every exit path either cleans up its state or persists an incremented
 * attempt count; leaving both undone would strand the session in a loop that
 * re-runs the same check with the same counter forever.
 *
 * Callers supply:
 *   files       — absolute paths to check (already filtered to their scope)
 *   fix         — optional, mechanically fixes what it can before checking
 *   check       — returns { failed, report }
 *   onCap       — optional, called instead of blocking once attempts run out
 *   buildMessage— returns { stopReason?, systemMessage } for the block payload
 *
 * Returns { blocked, reason } describing which path was taken, so hooks and
 * their tests can assert on the outcome rather than on stdout alone.
 */
function runFixLoop({
  input,
  dir,
  stateFiles,
  attemptsFile = path.join(dir, 'attempts.json'),
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  files,
  fix,
  check,
  onCap,
  buildMessage,
  write = (text) => process.stdout.write(text),
}) {
  if (!input) return { blocked: false, reason: 'no-input' };

  if (!files || files.length === 0) {
    cleanup(dir, stateFiles);
    return { blocked: false, reason: 'no-files' };
  }

  const attempts = readAttempts(attemptsFile);

  let outcome;
  try {
    if (fix) fix(files);
    outcome = check(files);
  } catch (error) {
    /*
     * A check that can't run at all is not a check that failed. Leave the
     * state in place so the next stop retries, and let the caller report it —
     * blocking on a broken toolchain would trap the session.
     */
    return { blocked: false, reason: 'error', error };
  }

  if (!outcome.failed) {
    cleanup(dir, stateFiles);
    return { blocked: false, reason: 'clean' };
  }

  if (attempts >= maxAttempts) {
    if (onCap) onCap({ files, outcome, maxAttempts });
    cleanup(dir, stateFiles);
    return { blocked: false, reason: 'cap', outcome };
  }

  const attempt = attempts + 1;
  writeAttempts(attemptsFile, attempt);

  const { stopReason, systemMessage } = buildMessage({ attempt, maxAttempts, outcome, files });

  write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: input.hook_event_name || 'Stop',
        decision: 'continue',
        ...(stopReason ? { stopReason } : {}),
        systemMessage,
      },
    }),
  );

  return { blocked: true, reason: 'blocked', attempt, outcome };
}

module.exports = { runFixLoop, DEFAULT_MAX_ATTEMPTS };
