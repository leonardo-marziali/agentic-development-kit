'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PKG_ROOT = path.join(__dirname, '..');

/*
 * readStdin/readHookInput read file descriptor 0, so they can only be
 * exercised honestly in a child process with a real stdin attached.
 */
function readInputWith(stdin) {
  const script = `
    const { readHookInput } = require(${JSON.stringify(PKG_ROOT)});
    process.stdout.write(JSON.stringify({ value: readHookInput() }));
  `;
  const result = spawnSync('node', ['-e', script], { input: stdin, encoding: 'utf8' });
  return JSON.parse(result.stdout).value;
}

test('parses a hook payload from stdin', () => {
  const value = readInputWith(JSON.stringify({ tool_name: 'Edit', session_id: 'abc' }));
  assert.strictEqual(value.tool_name, 'Edit');
  assert.strictEqual(value.session_id, 'abc');
});

test('empty stdin reads as an empty payload, not a failure', () => {
  assert.deepStrictEqual(readInputWith(''), {});
});

test('malformed JSON reads as null', () => {
  assert.strictEqual(readInputWith('{not json'), null);
});
