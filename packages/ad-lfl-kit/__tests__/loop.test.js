'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { runFixLoop, DEFAULT_MAX_ATTEMPTS, MAX_REASON_CHARS } = require('../loop');
const { writeAttempts, readAttempts } = require('../state');
const { mkScratchDir, rmScratchDir, writeFile } = require('./helpers');

const STATE_FILES = ['touched.txt', 'attempts.json'];

function setup() {
  const scratch = mkScratchDir();
  const dir = path.join(scratch, 'state');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'touched.txt'), 'x');

  const written = [];
  const base = {
    input: { hook_event_name: 'Stop', session_id: 's' },
    dir,
    stateFiles: STATE_FILES,
    write: (text) => written.push(text),
    buildMessage: ({ attempt, maxAttempts, outcome }) => ({
      stopReason: 'still failing',
      systemMessage: `attempt ${attempt}/${maxAttempts}: ${outcome.report}`,
    }),
  };
  return { scratch, dir, written, base, files: [writeFile(scratch, 'a.js')] };
}

test('allows the stop and cleans up when the check passes', () => {
  const { scratch, dir, written, base, files } = setup();
  try {
    const result = runFixLoop({ ...base, files, check: () => ({ failed: false }) });

    assert.strictEqual(result.blocked, false);
    assert.strictEqual(result.reason, 'clean');
    assert.strictEqual(written.length, 0, 'must not write a block payload');
    assert.strictEqual(fs.existsSync(dir), false, 'state must be cleaned up');
  } finally {
    rmScratchDir(scratch);
  }
});

test('blocks with a top-level decision block when the check fails', () => {
  const { scratch, dir, written, base, files } = setup();
  try {
    const result = runFixLoop({
      ...base,
      files,
      check: () => ({ failed: true, report: 'two issues' }),
    });

    assert.strictEqual(result.blocked, true);
    assert.strictEqual(result.attempt, 1);

    /*
     * The only shape Claude Code honours for blocking a stop: anything under
     * hookSpecificOutput (bar additionalContext) is ignored and the stop goes
     * through.
     */
    const payload = JSON.parse(written[0]);
    assert.deepStrictEqual(Object.keys(payload).sort(), ['decision', 'reason', 'systemMessage']);
    assert.strictEqual(payload.decision, 'block');
    assert.match(payload.reason, /attempt 1\/3: two issues/);
    assert.strictEqual(payload.systemMessage, 'still failing');
    assert.strictEqual(readAttempts(path.join(dir, 'attempts.json')), 1);
  } finally {
    rmScratchDir(scratch);
  }
});

test('blocks a SubagentStop with the same payload', () => {
  const { scratch, written, base, files } = setup();
  try {
    runFixLoop({
      ...base,
      input: { hook_event_name: 'SubagentStop' },
      files,
      check: () => ({ failed: true, report: 'x' }),
    });
    const payload = JSON.parse(written[0]);
    assert.strictEqual(payload.decision, 'block');
    assert.strictEqual('hookSpecificOutput' in payload, false);
  } finally {
    rmScratchDir(scratch);
  }
});

test('runs fix before check', () => {
  const { scratch, base, files } = setup();
  try {
    const order = [];
    runFixLoop({
      ...base,
      files,
      fix: () => order.push('fix'),
      check: () => {
        order.push('check');
        return { failed: false };
      },
    });
    assert.deepStrictEqual(order, ['fix', 'check']);
  } finally {
    rmScratchDir(scratch);
  }
});

test('stops blocking at the attempt cap and calls onCap', () => {
  const { scratch, dir, written, base, files } = setup();
  try {
    writeAttempts(path.join(dir, 'attempts.json'), DEFAULT_MAX_ATTEMPTS);

    let capped;
    const result = runFixLoop({
      ...base,
      files,
      check: () => ({ failed: true, report: 'unfixable' }),
      onCap: (info) => {
        capped = info;
      },
    });

    assert.strictEqual(result.blocked, false);
    assert.strictEqual(result.reason, 'cap');
    assert.strictEqual(written.length, 0, 'must not block once capped');
    assert.strictEqual(capped.maxAttempts, DEFAULT_MAX_ATTEMPTS);
    assert.strictEqual(capped.outcome.report, 'unfixable');
    assert.strictEqual(fs.existsSync(dir), false, 'state must be cleaned up at the cap');
  } finally {
    rmScratchDir(scratch);
  }
});

test('still blocks on the final attempt before the cap', () => {
  const { scratch, base, files } = setup();
  try {
    writeAttempts(path.join(base.dir, 'attempts.json'), DEFAULT_MAX_ATTEMPTS - 1);
    const result = runFixLoop({
      ...base,
      files,
      check: () => ({ failed: true, report: 'x' }),
    });
    assert.strictEqual(result.blocked, true);
    assert.strictEqual(result.attempt, DEFAULT_MAX_ATTEMPTS);
  } finally {
    rmScratchDir(scratch);
  }
});

test('honours a custom maxAttempts', () => {
  const { scratch, base, files } = setup();
  try {
    writeAttempts(path.join(base.dir, 'attempts.json'), 1);
    const result = runFixLoop({
      ...base,
      maxAttempts: 1,
      files,
      check: () => ({ failed: true, report: 'x' }),
    });
    assert.strictEqual(result.reason, 'cap');
  } finally {
    rmScratchDir(scratch);
  }
});

test('cleans up and allows the stop when nothing is left to check', () => {
  const { scratch, dir, base } = setup();
  try {
    const result = runFixLoop({ ...base, files: [], check: () => ({ failed: true }) });
    assert.strictEqual(result.reason, 'no-files');
    assert.strictEqual(fs.existsSync(dir), false);
  } finally {
    rmScratchDir(scratch);
  }
});

test('does nothing without a hook payload', () => {
  const { scratch, dir, base } = setup();
  try {
    const result = runFixLoop({
      ...base,
      input: null,
      files: ['x'],
      check: () => ({ failed: true }),
    });
    assert.strictEqual(result.reason, 'no-input');
    assert.strictEqual(fs.existsSync(dir), true, 'state must survive an unreadable payload');
  } finally {
    rmScratchDir(scratch);
  }
});

test('a throwing check neither blocks nor discards state', () => {
  const { scratch, dir, written, base, files } = setup();
  try {
    const boom = new Error('toolchain missing');
    const result = runFixLoop({
      ...base,
      files,
      check: () => {
        throw boom;
      },
    });

    assert.strictEqual(result.blocked, false);
    assert.strictEqual(result.reason, 'error');
    assert.strictEqual(result.error, boom);
    assert.strictEqual(written.length, 0);
    assert.strictEqual(fs.existsSync(dir), true, 'state must survive so the next stop retries');
  } finally {
    rmScratchDir(scratch);
  }
});

test('omits stopReason when buildMessage does not supply one', () => {
  const { scratch, written, base, files } = setup();
  try {
    runFixLoop({
      ...base,
      files,
      check: () => ({ failed: true, report: 'x' }),
      buildMessage: () => ({ systemMessage: 'only a message' }),
    });
    const payload = JSON.parse(written[0]);
    assert.strictEqual('systemMessage' in payload, false);
    assert.strictEqual(payload.reason, 'only a message');
  } finally {
    rmScratchDir(scratch);
  }
});

test('cuts a reason longer than Claude Code delivers whole, and says so', () => {
  const { scratch, written, base, files } = setup();
  try {
    runFixLoop({
      ...base,
      files,
      check: () => ({ failed: true, report: 'x' }),
      buildMessage: () => ({ systemMessage: 'y'.repeat(MAX_REASON_CHARS + 500) }),
    });
    const { reason } = JSON.parse(written[0]);
    assert.ok(reason.length < 10000, `reason is ${reason.length} chars`);
    assert.match(reason, /500 more characters omitted/);
  } finally {
    rmScratchDir(scratch);
  }
});
