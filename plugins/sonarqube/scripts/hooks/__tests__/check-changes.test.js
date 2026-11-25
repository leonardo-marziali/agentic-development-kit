'use strict';

/*
 * scripts/check-changes.js: the Stop hook's analysis and blocking policy as a
 * standalone command, against the same stand-in `sonarlint` CLI the hook
 * suite uses (see helpers.js). Each verdict is compared with what the hook
 * decides on the same fixture, so the two can't drift.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  setup,
  writeFile,
  runHook,
  installFakeSonarlint,
  readInvocations,
  issue,
  gitRepo,
} = require('./helpers');

const CLI = path.join(__dirname, '..', '..', 'check-changes.js');
const LINES = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);

function cli(ctx, args, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ctx.scratch,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_DATA: ctx.pluginData, ...env },
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
function hookVerdict(ctx, file, env) {
  const session = { session_id: ctx.sessionId, cwd: ctx.scratch };
  const hookEnv = { env: { CLAUDE_PLUGIN_DATA: ctx.pluginData, ...env } };
  runHook(
    'track-touched.js',
    { ...session, tool_name: 'Write', tool_input: { file_path: file } },
    hookEnv,
  );
  const res = runHook('check-and-loop.js', { ...session, hook_event_name: 'Stop' }, hookEnv);
  return res.json?.decision === 'block' ? 'block' : 'pass';
}

// A committed 30-line file with line 20 changed since.
function setupRepo(t) {
  const ctx = setup(t);
  const repo = gitRepo(ctx.scratch);
  const file = writeFile(ctx.scratch, 'src/app.js', `${LINES.join('\n')}\n`);
  repo.commitAll();
  const changed = [...LINES];
  changed[19] = 'changed line 20';
  fs.writeFileSync(file, `${changed.join('\n')}\n`);
  return { ...ctx, file };
}

const OLD_HIGH = issue('src/app.js', 'javascript:S2259', 'HIGH', 3);
const NEW_CRITICAL = issue('src/app.js', 'javascript:S3776', 'CRITICAL', 20);
const OLD_SECRET = issue('src/app.js', 'secrets:S6290', 'BLOCKER', 1);

test('a pre-existing HIGH on an unchanged line does not block, as in the hook', (t) => {
  const ctx = setupRepo(t);
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [OLD_HIGH] } });

  const res = cli(ctx, ['--format', 'json', '--', ctx.file], fake.env);

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json.findings, []);
  assert.deepEqual(res.json.outOfScope, [{ file: ctx.file, count: 1 }]);
  assert.equal(hookVerdict(ctx, ctx.file, fake.env), 'pass');
});

test('a new finding in scope blocks, and a secret blocks anywhere', (t) => {
  const ctx = setupRepo(t);
  const fake = installFakeSonarlint(ctx.scratch, {
    files: { issues: [OLD_HIGH, NEW_CRITICAL, OLD_SECRET] },
  });

  const res = cli(ctx, ['--format', 'json', '--', ctx.file], fake.env);

  assert.equal(res.status, 1, res.stderr);
  assert.deepEqual(
    res.json.findings.map((f) => [f.file, f.line, f.rule, f.severity]),
    [
      [ctx.file, 1, 'secrets:S6290', 'BLOCKER'],
      [ctx.file, 20, 'javascript:S3776', 'CRITICAL'],
    ],
  );
  assert.equal(hookVerdict(ctx, ctx.file, fake.env), 'block');
});

test('text output is the hook report; the analysis runs once from the cwd', (t) => {
  const ctx = setupRepo(t);
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [NEW_CRITICAL] } });

  const res = cli(ctx, ['--', ctx.file], fake.env);

  assert.equal(res.status, 1);
  assert.match(res.stdout, /^- src\/app\.js:20 CRITICAL javascript:S3776: /m);
  const [call] = readInvocations(fake.logFile);
  assert.deepEqual(call.argv.slice(0, 2), ['files', ctx.file]);
  assert.equal(call.cwd, fs.realpathSync(ctx.scratch));
});

test('min_blocking_severity is honoured as in the hook', (t) => {
  const ctx = setupRepo(t);
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [NEW_CRITICAL] } });
  const env = { ...fake.env, CLAUDE_PLUGIN_OPTION_MIN_BLOCKING_SEVERITY: 'secrets-only' };

  assert.equal(cli(ctx, ['--', ctx.file], env).status, 0);
  assert.equal(hookVerdict(ctx, ctx.file, env), 'pass');
});

test('--fix writes nothing', (t) => {
  const ctx = setupRepo(t);
  const before = fs.readFileSync(ctx.file, 'utf8');
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [NEW_CRITICAL] } });

  const res = cli(ctx, ['--fix', '--format', 'json', '--', ctx.file], fake.env);

  assert.equal(res.status, 1);
  assert.deepEqual(res.json.fixed, []);
  assert.equal(fs.readFileSync(ctx.file, 'utf8'), before);
});

test('an untracked file is checked whole', (t) => {
  const ctx = setupRepo(t);
  const file = writeFile(ctx.scratch, 'src/new.js', `${LINES.join('\n')}\n`);
  const fake = installFakeSonarlint(ctx.scratch, {
    files: { issues: [issue('src/new.js', 'javascript:S2259', 'HIGH', 3)] },
  });

  const res = cli(ctx, ['--format', 'json', '--', file], fake.env);

  assert.equal(res.status, 1, res.stderr);
  assert.equal(res.json.findings.length, 1);
  assert.equal(hookVerdict(ctx, file, fake.env), 'block');
});

test('ignored paths are not analyzed', (t) => {
  const ctx = setupRepo(t);
  fs.writeFileSync(path.join(ctx.scratch, '.gitignore'), 'dist/\n');
  const ignored = writeFile(ctx.scratch, 'dist/out.js');
  const fake = installFakeSonarlint(ctx.scratch, { files: { issues: [] } });

  const res = cli(ctx, ['--format', 'json', '--', ignored], fake.env);

  assert.equal(res.status, 0, res.stderr);
  assert.deepEqual(res.json.checked, []);
  assert.deepEqual(readInvocations(fake.logFile), []);
});

test('an engine that cannot run (SLOOP not installed) is exit 2, never clean', (t) => {
  const ctx = setupRepo(t);
  const fake = installFakeSonarlint(ctx.scratch, {
    files: { status: 2, stderr: 'SLOOP is not installed\n' },
  });

  const res = cli(ctx, ['--format', 'json', '--', ctx.file], fake.env);

  assert.equal(res.status, 2, res.stdout);
  assert.match(res.json.warnings.join('\n'), /SLOOP is not installed/);
  assert.equal(hookVerdict(ctx, ctx.file, fake.env), 'pass');
});

test('the data dir reaches the engine through CLAUDE_PLUGIN_DATA', (t) => {
  const ctx = setupRepo(t);
  const probe = path.join(ctx.scratch, 'probe.js');
  const seen = path.join(ctx.scratch, 'seen.txt');
  fs.writeFileSync(
    probe,
    `require('node:fs').writeFileSync(${JSON.stringify(seen)}, process.env.CLAUDE_PLUGIN_DATA || '');\n` +
      `process.stdout.write(JSON.stringify({ issues: [], skipped: [] }));\n`,
  );

  const res = cli(ctx, ['--', ctx.file], { SONARLINT_CLI: probe });

  assert.equal(res.status, 0, res.stderr);
  assert.equal(fs.readFileSync(seen, 'utf8'), ctx.pluginData);
});
