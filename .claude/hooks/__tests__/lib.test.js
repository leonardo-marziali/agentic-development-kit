'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { quoteForCmd } = require('../lib');

test('quoteForCmd: wraps a plain argument without duplicating it', () => {
  /*
   * Regression guard: an earlier version counted trailing backslashes and
   * appended value.slice(-count). With none, that is slice(-0) — the whole
   * string — so every plain argument was emitted twice.
   */
  assert.equal(quoteForCmd('test'), '"test"');
  assert.equal(quoteForCmd('C:\\repo\\plugins\\markdown'), '"C:\\repo\\plugins\\markdown"');
});

test('quoteForCmd: doubles trailing backslashes so they cannot escape the closing quote', () => {
  assert.equal(quoteForCmd('C:\\tmp\\dir\\'), '"C:\\tmp\\dir\\\\"');
  assert.equal(quoteForCmd('C:\\tmp\\dir\\\\'), '"C:\\tmp\\dir\\\\\\\\"');
});

test('quoteForCmd: escapes embedded quotes, doubling the backslashes before them', () => {
  assert.equal(quoteForCmd('a"b'), '"a""b"');
  assert.equal(quoteForCmd('a\\"b'), '"a\\\\""b"');
});

test('quoteForCmd: coerces non-strings', () => {
  assert.equal(quoteForCmd(42), '"42"');
});
