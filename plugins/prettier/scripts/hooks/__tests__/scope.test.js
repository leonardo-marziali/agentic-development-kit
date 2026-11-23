'use strict';

/*
Changed-lines scoping, end to end through the real `npx prettier` (see
format.test.js for why it isn't mocked). Inside a git repo only Prettier's
changes on or near the lines that differ from HEAD are written; outside a
repo (format.test.js), for an untracked file, and with `whole_files` on,
the whole file is formatted as before.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchRepo, rmScratchDir, uniqueSessionId, runHook } = require('./helpers');

// Eight badly formatted statements, committed as-is.
const MESSY = 'abcdefgh'
  .split('')
  .map((name, i) => `const ${name}   =  ${i + 1}\n`)
  .join('');

function format(file, repo, env = {}) {
  return runHook(
    'format.js',
    {
      tool_name: 'Write',
      tool_input: { file_path: file },
      session_id: uniqueSessionId(),
      cwd: repo,
    },
    { env },
  );
}

function setup(t, files = { 'x.js': MESSY }) {
  const repo = mkScratchRepo(files);
  t.after(() => rmScratchDir(repo));
  return repo;
}

test('in a git repo, only the edited line and its context are formatted', (t) => {
  const repo = setup(t);
  const file = path.join(repo, 'x.js');
  fs.writeFileSync(file, MESSY.replace('const g   =  7', 'const gg   =  77'));

  const res = format(file, repo);

  assert.equal(res.status, 0);
  // Line 7 changed; the default margin of 2 lines reaches lines 5 to 8.
  assert.equal(
    fs.readFileSync(file, 'utf8'),
    'const a   =  1\nconst b   =  2\nconst c   =  3\nconst d   =  4\n' +
      'const e = 5;\nconst f = 6;\nconst gg = 77;\nconst h = 8;\n',
  );
});

test('in a git repo, an untracked file is formatted whole', (t) => {
  const repo = setup(t);
  const file = path.join(repo, 'new.js');
  fs.writeFileSync(file, 'const a   =  1\nconst b   =  2\n');

  format(file, repo);

  assert.equal(fs.readFileSync(file, 'utf8'), 'const a = 1;\nconst b = 2;\n');
});

test('whole_files on: the whole file is formatted in a git repo too', (t) => {
  const repo = setup(t);
  const file = path.join(repo, 'x.js');
  fs.writeFileSync(file, MESSY.replace('const g   =  7', 'const gg   =  77'));

  format(file, repo, { CLAUDE_PLUGIN_OPTION_WHOLE_FILES: 'true' });

  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /^const a = 1;$/m);
  assert.match(after, /^const gg = 77;$/m);
});

test('in a git repo, a file Prettier has no parser for is left alone quietly', (t) => {
  const repo = setup(t, { 'notes.unknownext': 'a   b\n' });
  const file = path.join(repo, 'notes.unknownext');
  fs.writeFileSync(file, 'a   b\nc   d\n');

  const res = format(file, repo);

  assert.equal(res.status, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), 'a   b\nc   d\n');
  assert.doesNotMatch(res.stderr, /failed/);
});

test('in a git repo, a file in .prettierignore is left alone', (t) => {
  const repo = setup(t, { 'x.js': MESSY, '.prettierignore': 'x.js\n' });
  const file = path.join(repo, 'x.js');
  const edited = MESSY.replace('const g   =  7', 'const gg   =  77');
  fs.writeFileSync(file, edited);

  format(file, repo);

  assert.equal(fs.readFileSync(file, 'utf8'), edited);
});
