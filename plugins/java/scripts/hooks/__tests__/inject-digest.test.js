'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchDir, rmScratchDir, runHook, writeTree, HOOKS_DIR } = require('./helpers');
const { buildDigest } = require('../inject-digest');

function project(t, config) {
  const root = mkScratchDir();
  t.after(() => rmScratchDir(root));
  fs.mkdirSync(path.join(root, '.git'));
  if (config !== undefined) {
    writeTree(root, { '.claude/java-standards.json': JSON.stringify(config) });
  }
  return root;
}

const OUT_OF_SCOPE =
  'Outside these paths, follow the conventions of the surrounding code instead of this standard.';

test('prints nothing in a project without java-standards.json', (t) => {
  const root = project(t);
  const res = runHook('inject-digest.js', { hook_event_name: 'SessionStart', cwd: root });
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), '');
});

for (const event of ['SessionStart', 'SubagentStart']) {
  test(`adds the digest and the scope as context on ${event}`, (t) => {
    const root = project(t, { include: ['src/main/java/com/acme/v2/'], exclude: ['**/v1/'] });
    const res = runHook('inject-digest.js', {
      hook_event_name: event,
      cwd: path.join(root, 'src'),
    });

    assert.equal(res.status, 0);
    const output = res.json.hookSpecificOutput;
    assert.equal(output.hookEventName, event);
    assert.match(output.additionalContext, /src\/main\/java\/com\/acme\/v2\//);
    assert.match(output.additionalContext, /\*\*\/v1\//);
    assert.ok(output.additionalContext.includes(OUT_OF_SCOPE));
    assert.match(output.additionalContext, /J16/);
  });
}

test('keeps the digest under the 9,500-character context budget', () => {
  const digest = buildDigest({
    include: ['src/main/java/com/acme/orders/v2/', 'src/test/java/**/v2/'],
    exclude: ['**/v1/', '**/generated/'],
  });
  assert.ok(digest.length < 9500, `digest is ${digest.length} characters`);
});

test('names every section of the standard', () => {
  const digest = fs.readFileSync(path.join(HOOKS_DIR, 'digest.md'), 'utf8');
  for (const id of ['J1', 'B1', 'S1', 'D1', 'T1']) assert.match(digest, new RegExp(`\\b${id}\\b`));
});
