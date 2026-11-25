'use strict';

/*
scripts/check-changes.js: the Stop hook's check as a standalone command.
Each verdict is compared with what the hook itself decides on the same
fixture, through the real `npx markdownlint-cli`, so the two can't drift.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { mkScratchRepo, rmScratchDir, uniqueSessionId, runHook } = require('./helpers');

const CLI = path.join(__dirname, '..', '..', 'check-changes.js');

// A pre-existing MD025 (second top-level heading) far from the edits.
const LINES = ['# Title', '', '# Old Second Title', ''];
for (let i = 1; i <= 20; i += 1) LINES.push(`Paragraph ${i}.`, '');
const ORIGINAL = `${LINES.join('\n').trimEnd()}\n`;

function cli(args, env = {}) {
  const result = spawnSync('node', [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }
  return { ...result, json };
}

function setup(t, contents = ORIGINAL) {
  const repo = mkScratchRepo({ 'doc.md': contents });
  t.after(() => rmScratchDir(repo));
  return { repo, file: path.join(repo, 'doc.md') };
}

// The hook's verdict on the same file: 'block' or 'pass'.
function hookVerdict({ repo, file }) {
  const env = { CLAUDE_PLUGIN_DATA: path.join(repo, '.plugin-data') };
  const session = { session_id: uniqueSessionId(), cwd: repo };
  runHook(
    'track-touched.js',
    { ...session, tool_name: 'Write', tool_input: { file_path: file } },
    { env },
  );
  const res = runHook('check-and-loop.js', { ...session, hook_event_name: 'Stop' }, { env });
  return res.json?.decision === 'block' ? 'block' : 'pass';
}

test('a pre-existing violation out of scope does not block, and --fix leaves the file alone', (t) => {
  const ctx = setup(t);
  const text = ORIGINAL.replace('Paragraph 15.', 'Paragraph fifteen.');
  fs.writeFileSync(ctx.file, text);

  const res = cli(['--fix', '--format', 'json', '--', ctx.file]);

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json.findings, []);
  assert.deepEqual(res.json.outOfScope, [{ file: ctx.file, count: 1 }]);
  assert.deepEqual(res.json.fixed, []);
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), text);
  assert.equal(hookVerdict(ctx), 'pass');
});

test('a new violation in scope blocks, as in the hook', (t) => {
  const ctx = setup(t);
  const text = ORIGINAL.replace('Paragraph 15.', '# New Title');
  fs.writeFileSync(ctx.file, text);
  const line = text.split('\n').indexOf('# New Title') + 1;

  const res = cli(['--format', 'json', '--', ctx.file]);

  assert.equal(res.status, 1, res.stderr);
  assert.deepEqual(
    res.json.findings.map((f) => [f.file, f.line, f.rule.split('/')[0]]),
    [[ctx.file, line, 'MD025']],
  );
  assert.equal(res.json.plugin, 'markdown');
  assert.deepEqual(res.json.checked, [ctx.file]);
  assert.equal(hookVerdict(ctx), 'block');
});

test('text output is the report the hook shows Claude', (t) => {
  const ctx = setup(t);
  fs.writeFileSync(ctx.file, ORIGINAL.replace('Paragraph 15.', '# New Title'));

  const res = cli(['--', ctx.file]);

  assert.equal(res.status, 1);
  assert.match(res.stdout, /doc\.md:\d+ error MD025\/single-title\/single-h1 /);
  assert.match(res.stderr, /markdown plugin: 1 pre-existing markdownlint violation/);
});

test('without --fix nothing is written; with --fix an in-scope fixable violation is fixed', (t) => {
  const clean = ORIGINAL.replace('# Old Second Title', '## Old');
  const ctx = setup(t, clean);
  const dirty = clean.replace('Paragraph 15.', 'Paragraph 15. ');
  fs.writeFileSync(ctx.file, dirty);

  const check = cli(['--format', 'json', '--', ctx.file]);
  assert.equal(check.status, 1);
  assert.equal(check.json.findings[0].rule.split('/')[0], 'MD009');
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), dirty, 'a check must not write');

  const fix = cli(['--fix', '--format', 'json', '--', ctx.file]);
  assert.equal(fix.status, 0, fix.stderr);
  assert.deepEqual(fix.json.fixed, [ctx.file]);
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), clean);

  fs.writeFileSync(ctx.file, dirty);
  assert.equal(hookVerdict(ctx), 'pass');
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), clean, 'the hook fixes it the same way');
});

test('an untracked file is checked whole', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.repo, 'new.md');
  fs.writeFileSync(file, ORIGINAL);

  const res = cli(['--format', 'json', '--', file]);

  assert.equal(res.status, 1);
  assert.equal(res.json.findings.length, 1);
  assert.deepEqual(res.json.outOfScope, []);
  assert.equal(hookVerdict({ ...ctx, file }), 'block');
});

test('--ref scopes against another commit', (t) => {
  const ctx = setup(t);
  fs.writeFileSync(ctx.file, ORIGINAL.replace('Paragraph 15.', '# New Title'));
  const git = (...args) => execFileSync('git', ['-C', ctx.repo, ...args], { stdio: 'pipe' });
  git('add', '--all');
  git(
    '-c',
    'user.email=t@example.com',
    '-c',
    'user.name=T',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '--quiet',
    '--no-verify',
    '-m',
    'second',
  );

  // Committed, so nothing differs from HEAD; the commit before still sees it.
  assert.equal(cli(['--', ctx.file]).status, 0);
  assert.equal(cli(['--ref', 'HEAD~1', '--', ctx.file]).status, 1);
  assert.equal(cli(['--ref', 'no-such-ref', '--', ctx.file]).status, 2);
});

test('paths that are not markdown files, or do not exist, are ignored', (t) => {
  const ctx = setup(t);
  const other = path.join(ctx.repo, 'notes.txt');
  fs.writeFileSync(other, '# x\n# y\n');

  const res = cli(['--format', 'json', '--', other, path.join(ctx.repo, 'gone.md')]);

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json.checked, []);
});

test('a markdownlint that cannot run is exit 2, never clean', (t) => {
  const ctx = setup(t);
  fs.writeFileSync(ctx.file, ORIGINAL.replace('Paragraph 15.', '# New Title'));
  // An empty npm cache, offline: npx has no markdownlint-cli to run.
  const offline = {
    npm_config_cache: path.join(ctx.repo, '.npm-cache'),
    npm_config_offline: 'true',
  };

  const res = cli(['--format', 'json', '--', ctx.file], offline);

  assert.equal(res.status, 2, res.stdout);
  assert.ok(
    res.json.warnings.some((w) => /markdownlint failed/.test(w)),
    res.stdout,
  );
});

test('bad arguments are exit 2', () => {
  assert.equal(cli(['--format', 'xml', '--', '/x.md']).status, 2);
  assert.equal(cli(['--bogus']).status, 2);
});
