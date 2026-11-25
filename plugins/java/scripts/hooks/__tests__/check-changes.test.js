'use strict';

/*
scripts/check-changes.js: the Stop hook's pipeline as a standalone command,
against the same fake engine as check-and-loop.test.js. Each verdict is
compared with what the hook decides on the same fixture, so the two can't
drift.
*/

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  mkScratchDir,
  rmScratchDir,
  uniqueSessionId,
  runHook,
  writeTree,
  initRepo,
} = require('./helpers');

const CLI = path.join(__dirname, '..', '..', 'check-changes.js');
const FAKE_ENGINE = path.join(__dirname, 'fake-engine.js');

const POM = `<project>
  <properties><java.version>17</java.version></properties>
</project>
`;
const JAVA = (body) => `package demo;\n\nclass A {\n${body}\n}\n`;
const OLD = Array.from({ length: 12 }, (_, i) => `    int f${i};`).join('\n');
// A committed class with a pre-existing S3 finding far from the edits.
const LEGACY = JAVA(`    int legacy; // RULE:S3\n${OLD}`);
const REL = 'src/main/java/demo/A.java';

function setup(t, { committed = { [REL]: LEGACY }, config = {} } = {}) {
  const root = mkScratchDir();
  t.after(() => rmScratchDir(root));
  writeTree(root, {
    'pom.xml': POM,
    '.claude/java-standards.json': JSON.stringify(config),
    ...committed,
  });
  const git = initRepo(root);
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const ctx = {
    root,
    file: path.join(root, REL),
    pluginData: path.join(root, '.plugin-data'),
    sessionId: uniqueSessionId(),
    log: path.join(root, '.engine-calls.jsonl'),
  };
  ctx.env = {
    CLAUDE_PLUGIN_DATA: ctx.pluginData,
    JAVA_PLUGIN_ENGINE_CMD: FAKE_ENGINE,
    FAKE_ENGINE_LOG: ctx.log,
  };
  return ctx;
}

function cli(ctx, args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ctx.root,
    encoding: 'utf8',
    env: { ...process.env, ...ctx.env, ...env },
  });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = undefined;
  }
  return { ...result, json };
}

// The hook's verdict on the same file: 'block' or 'pass'.
function hookVerdict(ctx, file = ctx.file, env = {}) {
  const session = { session_id: ctx.sessionId, cwd: ctx.root };
  const hookEnv = { env: { ...ctx.env, ...env } };
  runHook(
    'track-touched.js',
    { ...session, tool_name: 'Edit', tool_input: { file_path: file } },
    hookEnv,
  );
  const res = runHook('check-and-loop.js', { ...session, hook_event_name: 'Stop' }, hookEnv);
  return res.json?.decision === 'block' ? 'block' : 'pass';
}

function engineCalls(ctx) {
  return fs.existsSync(ctx.log)
    ? fs
        .readFileSync(ctx.log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
}

test('a pre-existing finding out of scope does not block, and --fix leaves it', (t) => {
  const ctx = setup(t);
  const text = JAVA(`    int legacy; // RULE:S3\n${OLD}\n    int added;`);
  fs.writeFileSync(ctx.file, text);

  const res = cli(ctx, ['--fix', '--format', 'json', '--', ctx.file]);

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json.findings, []);
  assert.deepEqual(res.json.outOfScope, [{ file: ctx.file, count: 1 }]);
  assert.deepEqual(res.json.fixed, []);
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), text);
  assert.equal(hookVerdict(ctx), 'pass');
});

test('a new finding in scope blocks, as in the hook; text is the hook report', (t) => {
  const ctx = setup(t);
  fs.writeFileSync(
    ctx.file,
    JAVA(`    int legacy; // RULE:S3\n${OLD}\n    int added; // RULE:J16`),
  );

  const res = cli(ctx, ['--format', 'json', '--', ctx.file]);

  assert.equal(res.status, 1, res.stderr);
  assert.deepEqual(
    res.json.findings.map((f) => [f.file, f.line, f.rule]),
    [[ctx.file, 17, 'J16']],
  );
  const text = cli(ctx, ['--', ctx.file]);
  assert.match(text.stdout, /## Source rules\n\n- src\/main\/java\/demo\/A\.java:17 \[J16\]/);
  assert.match(text.stdout, /Already present \(not blocking\)[\s\S]*\[S3\]/);
  assert.equal(hookVerdict(ctx), 'block');
});

test('without --fix the engine only checks; with --fix it formats the changed ranges', (t) => {
  const ctx = setup(t);
  const text = JAVA(`    int legacy; // RULE:S3\n${OLD}\n    int added; // FORMAT_ME`);
  fs.writeFileSync(ctx.file, text);

  assert.equal(cli(ctx, ['--', ctx.file]).status, 0);
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), text, 'a check must not write');
  assert.ok(engineCalls(ctx).every((call) => call.request.endsWith('\t-\n')));

  const fix = cli(ctx, ['--fix', '--format', 'json', '--', ctx.file]);
  assert.equal(fix.status, 0, fix.stderr);
  assert.deepEqual(fix.json.fixed, [ctx.file]);
  assert.match(engineCalls(ctx).at(-1).request, /A\.java\t17-17\n/);
  const formatted = fs.readFileSync(ctx.file, 'utf8');
  assert.match(formatted, /FORMATTED/);

  fs.writeFileSync(ctx.file, text);
  assert.equal(hookVerdict(ctx), 'pass');
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), formatted, 'the hook formats it the same way');
});

test('an untracked file is checked whole', (t) => {
  const ctx = setup(t);
  const file = path.join(ctx.root, 'src/main/java/demo/B.java');
  writeTree(ctx.root, { 'src/main/java/demo/B.java': JAVA('    int b; // RULE:S3') });

  const res = cli(ctx, ['--format', 'json', '--', file]);

  assert.equal(res.status, 1, res.stderr);
  assert.deepEqual(
    res.json.findings.map((f) => f.rule),
    ['S3'],
  );
  assert.equal(hookVerdict(ctx, file), 'block');
});

test('paths the hook would not check are ignored', (t) => {
  const ctx = setup(t, { config: { include: ['src/main/java/demo/v2/'] } });
  const outOfConfig = path.join(ctx.root, REL);
  const notJava = path.join(ctx.root, 'README.md');
  writeTree(ctx.root, { 'README.md': 'x\n' });

  const res = cli(ctx, ['--format', 'json', '--', outOfConfig, notJava]);

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json.checked, []);
});

test('a missing engine is exit 2, never clean', (t) => {
  const ctx = setup(t);
  fs.writeFileSync(ctx.file, JAVA(`    int legacy; // RULE:S3\n${OLD}\n    int added;`));
  const env = { JAVA_PLUGIN_ENGINE_CMD: '', CLAUDE_PLUGIN_DATA: path.join(ctx.root, 'empty') };

  const res = cli(ctx, ['--format', 'json', '--', ctx.file], env);

  assert.equal(res.status, 2, res.stdout);
  assert.match(res.json.warnings.join('\n'), /engine is not installed/);
  assert.equal(hookVerdict(ctx, ctx.file, env), 'pass');
});

test('a file the engine cannot parse is exit 2', (t) => {
  const ctx = setup(t);
  fs.writeFileSync(ctx.file, JAVA('    BROKEN RULE:J16'));

  const res = cli(ctx, ['--format', 'json', '--', ctx.file]);

  assert.equal(res.status, 2, res.stdout);
  assert.match(res.json.warnings.join('\n'), /syntax errors/);
});

test('the Stop budget does not apply', (t) => {
  const ctx = setup(t);
  fs.writeFileSync(
    ctx.file,
    JAVA(`    int legacy; // RULE:S3\n${OLD}\n    int added; // RULE:J16`),
  );

  // A budget the hook would have used up before its sections even start.
  const res = cli(ctx, ['--format', 'json', '--', ctx.file], { JAVA_PLUGIN_STOP_BUDGET_MS: '1' });

  assert.equal(res.status, 1, res.stdout);
  assert.doesNotMatch(res.json.warnings.join('\n'), /time budget/);
});
