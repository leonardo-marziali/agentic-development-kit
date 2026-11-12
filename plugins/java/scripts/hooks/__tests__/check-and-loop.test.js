'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  mkScratchDir,
  rmScratchDir,
  uniqueSessionId,
  runHook,
  writeTree,
  initRepo,
} = require('./helpers');

const FAKE_ENGINE = path.join(__dirname, 'fake-engine.js');

const POM = `<project>
  <properties><java.version>17</java.version></properties>
</project>
`;

const ECLIPSE_PROFILE =
  '<profiles version="23"><profile kind="CodeFormatterProfile" name="t" version="23"></profile></profiles>\n';

/*
A scratch repository with a committed pom.xml (Java 17) and `committed`
files, plus the plugin's state and a fake engine.
*/
function setup(t, { committed = {}, config, gitRepo = true } = {}) {
  const root = mkScratchDir();
  t.after(() => rmScratchDir(root));
  const files = { 'pom.xml': POM, ...committed };
  if (config !== undefined) files['.claude/java-standards.json'] = JSON.stringify(config);
  writeTree(root, files);
  if (gitRepo) {
    const git = initRepo(root);
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
  }
  const ctx = {
    root,
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

// Writes `rel` and records it as edited by this session (or by a subagent).
function edit(ctx, rel, content, { agentId } = {}) {
  writeTree(ctx.root, { [rel]: content });
  runHook(
    'track-touched.js',
    {
      tool_name: 'Edit',
      tool_input: { file_path: path.join(ctx.root, rel) },
      session_id: ctx.sessionId,
      cwd: ctx.root,
      ...(agentId ? { agent_id: agentId } : {}),
    },
    { env: ctx.env },
  );
}

function stop(ctx, { event = 'Stop', agentId, env = {} } = {}) {
  return runHook(
    'check-and-loop.js',
    {
      hook_event_name: event,
      session_id: ctx.sessionId,
      cwd: ctx.root,
      ...(agentId ? { agent_id: agentId } : {}),
    },
    { env: { ...ctx.env, ...env } },
  );
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

const flagValue = (call, name) => call.args[call.args.indexOf(name) + 1];

const JAVA = (body) => `package demo;\n\nclass A {\n${body}\n}\n`;

test('stays silent without a config or a project formatter profile', (t) => {
  const ctx = setup(t);
  edit(ctx, 'src/main/java/demo/A.java', JAVA('    int a; // FORMAT_ME RULE:J16'));

  const res = stop(ctx);

  assert.equal(res.stdout.trim(), '', res.stderr);
  assert.deepEqual(engineCalls(ctx), []);
});

test("formats with the project's own profile but checks nothing without a config", (t) => {
  const ctx = setup(t, {
    committed: {
      'eclipse-formatter.xml': ECLIPSE_PROFILE,
      'src/main/java/demo/A.java': JAVA('    int a;'),
    },
  });
  edit(ctx, 'src/main/java/demo/A.java', JAVA('    int a;\n    int b; // FORMAT_ME RULE:J16'));

  const res = stop(ctx);

  assert.equal(res.stdout.trim(), '', res.stderr);
  const [call] = engineCalls(ctx);
  assert.equal(flagValue(call, '--rules'), 'off');
  assert.equal(flagValue(call, '--profile'), path.join(ctx.root, 'eclipse-formatter.xml'));
  assert.match(call.request, /A\.java\t5-5\n/);
  assert.match(
    fs.readFileSync(path.join(ctx.root, 'src/main/java/demo/A.java'), 'utf8'),
    /FORMATTED/,
  );
});

test('blocks on a rule finding in a line the session changed', (t) => {
  const ctx = setup(t, {
    config: {},
    committed: { 'src/main/java/demo/A.java': JAVA('    int a;') },
  });
  edit(ctx, 'src/main/java/demo/A.java', JAVA('    int a;\n    int b; // RULE:J16'));

  const res = stop(ctx);

  assert.equal(res.json?.decision, 'block', res.stderr);
  assert.match(res.json.reason, /## Source rules/);
  assert.match(res.json.reason, /A\.java:5 \[J16\] fake J16 finding/);
  const calls = engineCalls(ctx);
  assert.ok(
    calls.some(
      (call) => flagValue(call, '--rules') === 'on' && flagValue(call, '--source') === '17',
    ),
  );
});

test('a finding on a line the session never touched does not block', (t) => {
  const old = Array.from({ length: 12 }, (_, i) => `    int f${i};`).join('\n');
  const ctx = setup(t, {
    config: {},
    committed: { 'src/main/java/demo/A.java': JAVA(`    int legacy; // RULE:S3\n${old}`) },
  });
  edit(
    ctx,
    'src/main/java/demo/A.java',
    JAVA(`    int legacy; // RULE:S3\n${old}\n    int added;`),
  );

  const res = stop(ctx);

  assert.equal(res.stdout.trim(), '', res.stderr);
});

test('lists pre-existing findings as not blocking when something else blocks', (t) => {
  const old = Array.from({ length: 12 }, (_, i) => `    int f${i};`).join('\n');
  const ctx = setup(t, {
    config: {},
    committed: { 'src/main/java/demo/A.java': JAVA(`    int legacy; // RULE:S3\n${old}`) },
  });
  edit(
    ctx,
    'src/main/java/demo/A.java',
    JAVA(`    int legacy; // RULE:S3\n${old}\n    int added; // RULE:J16`),
  );

  const res = stop(ctx);

  assert.equal(res.json?.decision, 'block', res.stderr);
  assert.match(res.json.reason, /Already present \(not blocking\)[\s\S]*\[S3\]/);
});

test('passes --rules off when checks are disabled, and disabledRules through', (t) => {
  const ctx = setup(t, { config: { checks: { enabled: false } } });
  edit(ctx, 'src/main/java/demo/A.java', JAVA('    int b; // RULE:J16'));
  assert.equal(stop(ctx).stdout.trim(), '');
  assert.ok(engineCalls(ctx).every((call) => flagValue(call, '--rules') === 'off'));

  const other = setup(t, { config: { checks: { disabledRules: ['S3'] } } });
  edit(other, 'src/main/java/demo/A.java', JAVA('    int b;'));
  stop(other);
  assert.ok(engineCalls(other).some((call) => flagValue(call, '--disabled') === 'S3'));
});

test('passes the nullness mode, or off when NullAway is disabled', (t) => {
  const ctx = setup(t, { config: { nullaway: { annotations: 'spring' } } });
  edit(ctx, 'src/main/java/demo/A.java', JAVA('    int b;'));
  stop(ctx);
  assert.ok(engineCalls(ctx).some((call) => flagValue(call, '--nullness') === 'spring'));

  const off = setup(t, { config: { nullaway: { enabled: false } } });
  edit(off, 'src/main/java/demo/A.java', JAVA('    int b;'));
  stop(off);
  assert.ok(engineCalls(off).some((call) => flagValue(call, '--nullness') === 'off'));
});

test('only checks files inside the configured scope', (t) => {
  const ctx = setup(t, { config: { include: ['src/main/java/demo/v2/'] } });
  edit(ctx, 'src/main/java/demo/v1/Old.java', JAVA('    int b; // RULE:J16'));

  const res = stop(ctx);

  assert.equal(res.stdout.trim(), '', res.stderr);
  assert.ok(engineCalls(ctx).every((call) => !call.request.includes('Old.java')));
});

test('an engine error warns and never blocks', (t) => {
  const ctx = setup(t, { config: {} });
  edit(ctx, 'src/main/java/demo/A.java', JAVA('    BROKEN RULE:J16'));

  const res = stop(ctx);

  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /java plugin: .*syntax errors/);
});

test('without an installed engine, warns once and leaves Java files alone', (t) => {
  const ctx = setup(t, { config: {} });
  edit(ctx, 'src/main/java/demo/A.java', JAVA('    int b; // RULE:J16'));

  const res = stop(ctx, { env: { JAVA_PLUGIN_ENGINE_CMD: '' } });

  assert.equal(res.stdout.trim(), '');
  assert.match(res.stderr, /java plugin: .*engine is not installed/);
  assert.equal(
    fs.existsSync(path.join(ctx.pluginData, 'java-plugin', ctx.sessionId, 'touched-files.txt')),
    false,
  );
});

test('blocks on a build-file finding even without the engine', (t) => {
  const ctx = setup(t, { config: {} });
  edit(
    ctx,
    'pom.xml',
    POM.replace(
      '</project>',
      '  <dependencies><dependency><artifactId>x</artifactId><version>1.0</version></dependency></dependencies>\n</project>',
    ),
  );

  const res = stop(ctx, { env: { JAVA_PLUGIN_ENGINE_CMD: '' } });

  assert.equal(res.json?.decision, 'block', res.stderr);
  assert.match(res.json.reason, /## Build files[\s\S]*pom\.xml:3 \[B2\]/);
});

test('outside a git repository there is no config, so nothing happens', (t) => {
  const ctx = setup(t, { config: {}, gitRepo: false });
  edit(ctx, 'src/main/java/demo/A.java', JAVA('    int b; // FORMAT_ME RULE:J16'));

  assert.equal(stop(ctx).stdout.trim(), '');
  assert.deepEqual(engineCalls(ctx), []);
});

test("SubagentStop holds a subagent only to its own files; Stop checks everyone's", (t) => {
  const ctx = setup(t, { config: {} });
  edit(ctx, 'src/main/java/demo/Parent.java', JAVA('    int p; // RULE:J16'));
  edit(ctx, 'src/main/java/demo/Child.java', JAVA('    int c; // RULE:J16'), { agentId: 'sub1' });

  const sub = stop(ctx, { event: 'SubagentStop', agentId: 'sub1' });
  assert.equal(sub.json?.decision, 'block', sub.stderr);
  assert.match(sub.json.reason, /Child\.java/);
  assert.doesNotMatch(sub.json.reason, /Parent\.java/);

  const main = stop(ctx);
  assert.match(main.json.reason, /Child\.java/);
  assert.match(main.json.reason, /Parent\.java/);
});
