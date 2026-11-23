'use strict';

/*
Changed-lines scoping, end to end through the real `npx markdownlint-cli`
(see check-and-loop.test.js for why it isn't mocked). Inside a git repo
only violations on or near lines that differ from the session base block
the stop, and auto-fix and auto-suppression never rewrite a file that
also has violations elsewhere. Outside a repo (every other suite here) and
with `whole_files` on, whole files are checked as before.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchRepo, rmScratchDir, uniqueSessionId, runHook } = require('./helpers');

/*
A long document with two pre-existing violations far from where the tests
edit: a second top-level heading (MD025, not auto-fixable) and a trailing
space (MD009, auto-fixable).
*/
const LINES = ['# Title', ''];
for (let i = 1; i <= 30; i += 1) LINES.push(`Paragraph ${i}.`, '');
LINES.splice(4, 0, '# Old Second Title', '');
LINES[LINES.indexOf('Paragraph 3.')] = 'Paragraph 3. ';
const ORIGINAL = `${LINES.join('\n').trimEnd()}\n`;
const OLD_HEADING_LINE = LINES.indexOf('# Old Second Title') + 1;

function edited(from, to) {
  assert.ok(ORIGINAL.includes(from));
  return ORIGINAL.replace(from, to);
}

function lineOf(text, needle) {
  return text.split('\n').indexOf(needle) + 1;
}

function setup(t) {
  const repo = mkScratchRepo({ 'doc.md': ORIGINAL });
  t.after(() => rmScratchDir(repo));
  return {
    repo,
    file: path.join(repo, 'doc.md'),
    pluginData: path.join(repo, '.plugin-data'),
    sessionId: uniqueSessionId(),
  };
}

function track({ file, sessionId, repo, pluginData }) {
  return runHook(
    'track-touched.js',
    { tool_name: 'Write', tool_input: { file_path: file }, session_id: sessionId, cwd: repo },
    { env: { CLAUDE_PLUGIN_DATA: pluginData } },
  );
}

function stop({ sessionId, repo, pluginData }, options = {}) {
  const env = { CLAUDE_PLUGIN_DATA: pluginData };
  if (options.wholeFiles !== undefined) {
    env.CLAUDE_PLUGIN_OPTION_WHOLE_FILES = String(options.wholeFiles);
  }
  if (options.autoSuppress !== undefined) {
    env.CLAUDE_PLUGIN_OPTION_AUTO_SUPPRESS = String(options.autoSuppress);
  }
  return runHook(
    'check-and-loop.js',
    { hook_event_name: 'Stop', session_id: sessionId, cwd: repo },
    { env },
  );
}

test('in a git repo, only a violation on a changed line blocks', (t) => {
  const ctx = setup(t);
  const text = edited('Paragraph 25.', '# New Title');
  fs.writeFileSync(ctx.file, text);
  track(ctx);

  const res = stop(ctx);

  assert.equal(res.json?.decision, 'block', `expected a block, got: ${res.stdout}`);
  assert.match(res.json.reason, new RegExp(`doc\\.md:${lineOf(text, '# New Title')}\\b`));
  assert.doesNotMatch(res.json.reason, new RegExp(`doc\\.md:${OLD_HEADING_LINE}\\b`));
  assert.match(res.stderr, /pre-existing/);
});

test('in a git repo, pre-existing violations alone do not block and are not auto-fixed', (t) => {
  const ctx = setup(t);
  const text = edited('Paragraph 25.', 'Paragraph twenty-five.');
  fs.writeFileSync(ctx.file, text);
  track(ctx);

  const res = stop(ctx);

  assert.equal(res.stdout.trim(), '', `expected no block, got: ${res.stdout}`);
  assert.match(res.stderr, /pre-existing/);
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), text, 'the file must not be rewritten');
});

test('in a git repo, a fixable violation on a changed line is auto-fixed', (t) => {
  const ctx = setup(t);
  // Only the trailing space on the edited line; the old ones are elsewhere.
  const clean = edited('Paragraph 3. ', 'Paragraph 3.').replace('# Old Second Title', '## Old');
  const repo = mkScratchRepo({ 'doc.md': clean });
  t.after(() => rmScratchDir(repo));
  const file = path.join(repo, 'doc.md');
  const own = { ...ctx, repo, file, pluginData: path.join(repo, '.plugin-data') };
  fs.writeFileSync(file, clean.replace('Paragraph 25.', 'Paragraph 25. '));
  track(own);

  const res = stop(own);

  assert.equal(res.stdout.trim(), '', `expected no block, got: ${res.stdout}`);
  assert.equal(fs.readFileSync(file, 'utf8'), clean);
});

test('whole_files on: pre-existing violations block again', (t) => {
  const ctx = setup(t);
  fs.writeFileSync(ctx.file, edited('Paragraph 25.', 'Paragraph twenty-five.'));
  track(ctx);

  const res = stop(ctx, { wholeFiles: true });

  assert.equal(res.json?.decision, 'block', `expected a block, got: ${res.stdout}`);
  assert.match(res.json.reason, new RegExp(`doc\\.md:${OLD_HEADING_LINE}\\b`));
});

test('auto_suppress at the cap suppresses only violations on changed lines', (t) => {
  const ctx = setup(t);
  fs.writeFileSync(ctx.file, edited('Paragraph 25.', '# New Title'));
  track(ctx);

  for (let i = 0; i < 4; i += 1) stop(ctx, { autoSuppress: true });

  const after = fs.readFileSync(ctx.file, 'utf8').split('\n');
  const newAt = after.indexOf('# New Title');
  const oldAt = after.indexOf('# Old Second Title');
  assert.match(after[newAt - 1], /markdownlint-disable-next-line MD025/);
  assert.doesNotMatch(after[oldAt - 1], /markdownlint-disable/);
  assert.ok(after.includes('Paragraph 3. '), 'the old trailing space must be left alone');
});
