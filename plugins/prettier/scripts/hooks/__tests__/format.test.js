'use strict';

/*
Integration suite: these hit the real `npx prettier`, same as the hook
does at runtime (same convention as the markdown plugin's check-and-loop
tests — see its __tests__/check-and-loop.test.js). Requires network access
or a warm npx cache; each test spawns a real subprocess.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { mkScratchDir, rmScratchDir, uniqueSessionId, runHook, HOOKS_DIR } = require('./helpers');

function format(file, scratch, toolName = 'Write') {
  return runHook('format.js', {
    tool_name: toolName,
    tool_input: { file_path: file },
    session_id: uniqueSessionId(),
    cwd: scratch,
  });
}

test('formats a real file touched via Write', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const file = path.join(scratch, 'data.json');
  const original = '{"b":2,"a":1}';
  fs.writeFileSync(file, original);

  const res = format(file, scratch, 'Write');

  assert.equal(res.status, 0);
  const formatted = fs.readFileSync(file, 'utf8');
  assert.notEqual(formatted, original, 'file should have been reformatted');
  assert.deepEqual(JSON.parse(formatted), { b: 2, a: 1 }, 'values must be preserved');
});

test('formats a real file touched via Edit', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const file = path.join(scratch, 'data.json');
  const original = '{"x":1,   "y":2}';
  fs.writeFileSync(file, original);

  const res = format(file, scratch, 'Edit');

  assert.equal(res.status, 0);
  const formatted = fs.readFileSync(file, 'utf8');
  assert.notEqual(formatted, original);
  assert.deepEqual(JSON.parse(formatted), { x: 1, y: 2 });
});

test('ignores tool names other than Edit/Write', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const file = path.join(scratch, 'data.json');
  const original = '{"a":1,"b":2}';
  fs.writeFileSync(file, original);

  const res = format(file, scratch, 'Read');

  assert.equal(res.status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test("does nothing and exits 0 when file_path doesn't exist on disk", (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const file = path.join(scratch, 'missing.json');

  const res = format(file, scratch);

  assert.equal(res.status, 0);
  assert.equal(fs.existsSync(file), false);
});

test('skips files under node_modules', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const dir = path.join(scratch, 'node_modules', 'some-pkg');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'data.json');
  const original = '{"a":1,"b":2}';
  fs.writeFileSync(file, original);

  const res = format(file, scratch);

  assert.equal(res.status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('skips files under .git', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const dir = path.join(scratch, '.git', 'refs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'data.json');
  const original = '{"a":1,"b":2}';
  fs.writeFileSync(file, original);

  const res = format(file, scratch);

  assert.equal(res.status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('a file Prettier has no parser for is left untouched, hook still exits 0', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const file = path.join(scratch, 'data.xyz123');
  const original = 'not   a known    format\n';
  fs.writeFileSync(file, original);

  const res = format(file, scratch);

  assert.equal(res.status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('malformed JSON on stdin: exits 0, does nothing', () => {
  const result = spawnSync('node', [path.join(HOOKS_DIR, 'format.js')], {
    input: 'not valid json',
    encoding: 'utf8',
  });

  assert.equal(result.status, 0);
});

test('missing tool_input.file_path: exits 0, does nothing', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));

  const res = runHook('format.js', {
    tool_name: 'Write',
    tool_input: {},
    session_id: uniqueSessionId(),
    cwd: scratch,
  });

  assert.equal(res.status, 0);
});

test('non-blocking: hook exits 0 even when Prettier fails to parse the file', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const file = path.join(scratch, 'broken.json');
  const original = '{ this is not valid json';
  fs.writeFileSync(file, original);

  const res = format(file, scratch);

  assert.equal(res.status, 0, 'a formatting failure must never block the hook');
  assert.equal(fs.readFileSync(file, 'utf8'), original, 'unparseable file is left as-is');
  assert.match(res.stderr, /prettier plugin: formatting .* failed/);
});
