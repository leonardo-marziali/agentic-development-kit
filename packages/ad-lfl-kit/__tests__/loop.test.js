'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { runFixLoop, DEFAULT_MAX_ATTEMPTS } = require('../loop');
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

test('blocks with decision continue when the check fails', () => {
  const { scratch, dir, written, base, files } = setup();
  try {
    const result = runFixLoop({
      ...base,
      files,
      check: () => ({ failed: true, report: 'two issues' }),
    });

    assert.strictEqual(result.blocked, true);
    assert.strictEqual(result.attempt, 1);

    const payload = JSON.parse(written[0]).hookSpecificOutput;
    assert.strictEqual(payload.decision, 'continue');
    assert.strictEqual(payload.hookEventName, 'Stop');
    assert.strictEqual(payload.stopReason, 'still failing');
    assert.match(payload.systemMessage, /attempt 1\/3: two issues/);
    assert.strictEqual(readAttempts(path.join(dir, 'attempts.json')), 1);
  } finally {
    rmScratchDir(scratch);
  }
});

test('echoes SubagentStop back as the hook event name', () => {
  const { scratch, written, base, files } = setup();
  try {
    runFixLoop({
      ...base,
      input: { hook_event_name: 'SubagentStop' },
      files,
      check: () => ({ failed: true, report: 'x' }),
    });
    assert.strictEqual(JSON.parse(written[0]).hookSpecificOutput.hookEventName, 'SubagentStop');
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
    const payload = JSON.parse(written[0]).hookSpecificOutput;
    assert.strictEqual('stopReason' in payload, false);
    assert.strictEqual(payload.systemMessage, 'only a message');
  } finally {
    rmScratchDir(scratch);
  }
});
