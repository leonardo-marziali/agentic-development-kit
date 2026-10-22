'use strict';

/*
Integration suite: these hit the real `ruff format`, same as the hook does
at runtime (same convention as the markdown and prettier plugins' suites).
Each test spawns real subprocesses.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  mkScratchDir,
  rmScratchDir,
  uniqueSessionId,
  runHook,
  SKIP_WITHOUT_RUFF,
} = require('./helpers');

const UNFORMATTED = "x = {  'a':1 }\n";
const FORMATTED = 'x = {"a": 1}\n';

function format(file, scratch, { toolName = 'Write', env } = {}) {
  return runHook(
    'format.js',
    {
      tool_name: toolName,
      tool_input: { file_path: file },
      session_id: uniqueSessionId(),
      cwd: scratch,
    },
    { env },
  );
}

function setup(t) {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  return scratch;
}

test('formats a .py file touched via Write', { skip: SKIP_WITHOUT_RUFF }, (t) => {
  const scratch = setup(t);
  const file = path.join(scratch, 'mod.py');
  fs.writeFileSync(file, UNFORMATTED);

  const res = format(file, scratch);

  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.readFileSync(file, 'utf8'), FORMATTED);
});

test('formats a .py file touched via Edit', { skip: SKIP_WITHOUT_RUFF }, (t) => {
  const scratch = setup(t);
  const file = path.join(scratch, 'mod.py');
  fs.writeFileSync(file, UNFORMATTED);

  format(file, scratch, { toolName: 'Edit' });

  assert.equal(fs.readFileSync(file, 'utf8'), FORMATTED);
});

test("respects the project's ruff config", { skip: SKIP_WITHOUT_RUFF }, (t) => {
  const scratch = setup(t);
  fs.writeFileSync(
    path.join(scratch, 'pyproject.toml'),
    '[tool.ruff.format]\nquote-style = "single"\n',
  );
  const nested = path.join(scratch, 'src');
  fs.mkdirSync(nested);
  const file = path.join(nested, 'mod.py');
  fs.writeFileSync(file, UNFORMATTED);

  format(file, scratch);

  assert.equal(fs.readFileSync(file, 'utf8'), "x = {'a': 1}\n");
});

test("respects the project's ruff exclude", { skip: SKIP_WITHOUT_RUFF }, (t) => {
  const scratch = setup(t);
  fs.writeFileSync(path.join(scratch, 'pyproject.toml'), '[tool.ruff]\nexclude = ["generated"]\n');
  fs.mkdirSync(path.join(scratch, 'generated'));
  const file = path.join(scratch, 'generated', 'mod.py');
  fs.writeFileSync(file, UNFORMATTED);

  format(file, scratch);

  assert.equal(fs.readFileSync(file, 'utf8'), UNFORMATTED);
});

test('leaves non-Python files alone', { skip: SKIP_WITHOUT_RUFF }, (t) => {
  const scratch = setup(t);
  const file = path.join(scratch, 'notes.txt');
  fs.writeFileSync(file, UNFORMATTED);

  const res = format(file, scratch);

  assert.equal(res.status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), UNFORMATTED);
});

test('leaves files inside a virtualenv alone', { skip: SKIP_WITHOUT_RUFF }, (t) => {
  const scratch = setup(t);
  const dir = path.join(scratch, '.venv', 'lib');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'mod.py');
  fs.writeFileSync(file, UNFORMATTED);

  format(file, scratch);

  assert.equal(fs.readFileSync(file, 'utf8'), UNFORMATTED);
});

test('ignores tool names other than Edit/Write', (t) => {
  const scratch = setup(t);
  const file = path.join(scratch, 'mod.py');
  fs.writeFileSync(file, UNFORMATTED);

  const res = format(file, scratch, { toolName: 'Read' });

  assert.equal(res.status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), UNFORMATTED);
});

test("exits 0 when file_path doesn't exist on disk", (t) => {
  const scratch = setup(t);

  const res = format(path.join(scratch, 'missing.py'), scratch);

  assert.equal(res.status, 0);
});

test(
  'reports a syntax error on stderr without failing the hook',
  { skip: SKIP_WITHOUT_RUFF },
  (t) => {
    const scratch = setup(t);
    const file = path.join(scratch, 'mod.py');
    fs.writeFileSync(file, 'def f(:\n');

    const res = format(file, scratch);

    assert.equal(res.status, 0);
    assert.match(res.stderr, /formatting .*mod\.py failed/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'def f(:\n');
  },
);

test('fails open with a note when ruff cannot be found', (t) => {
  const scratch = setup(t);
  const file = path.join(scratch, 'mod.py');
  fs.writeFileSync(file, UNFORMATTED);

  const res = format(file, scratch, { env: { PATH: path.join(scratch, 'empty') } });

  assert.equal(res.status, 0);
  assert.match(res.stderr, /ruff not found/);
  assert.equal(fs.readFileSync(file, 'utf8'), UNFORMATTED);
});

test("uses the project's .venv ruff ahead of PATH", { skip: process.platform === 'win32' }, (t) => {
  const scratch = setup(t);
  const bin = path.join(scratch, '.venv', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const marker = path.join(scratch, 'called-with.txt');
  fs.writeFileSync(path.join(bin, 'ruff'), `#!/bin/sh\necho "$@" > "${marker}"\n`, {
    mode: 0o755,
  });
  const file = path.join(scratch, 'mod.py');
  fs.writeFileSync(file, UNFORMATTED);

  format(file, scratch);

  assert.equal(fs.readFileSync(marker, 'utf8').trim(), `format --force-exclude ${file}`);
});
