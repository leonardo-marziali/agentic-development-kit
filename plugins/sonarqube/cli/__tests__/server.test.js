'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { serverResult, renderServer, serverExitCode, ServerError } = require('../server');
const { parseArgs, UsageError } = require('../args');

const CLI = path.join(__dirname, '..', 'sonarlint.js');
const KEY = 'acme_wiki';

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonar-server-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function write(dir, rel, contents) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

function git(dir, ...args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}

/*
 * A bound git repository with one commit holding a workflow and a source
 * file, so the server's "last analysis" can name a real revision.
 */
function boundRepo(t) {
  const dir = scratch(t);
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'test');
  write(
    dir,
    '.sonarlint/connectedMode.json',
    JSON.stringify({ sonarCloudOrganization: 'acme', projectKey: KEY }),
  );
  const workflow = write(dir, '.github/workflows/publish.yml', 'on: push\n');
  const source = write(dir, 'src/app.py', 'print(1)\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  return { dir, workflow, source, revision: git(dir, 'rev-parse', 'HEAD') };
}

function serverIssue(rel, rule, line, extra = {}) {
  return {
    key: `${rule}@${rel}:${line}`,
    rule,
    component: `${KEY}:${rel}`,
    line,
    textRange: { startLine: line, endLine: line },
    message: `${rule} message`,
    severity: 'MAJOR',
    type: 'VULNERABILITY',
    impacts: [{ softwareQuality: 'SECURITY', severity: 'HIGH' }],
    status: 'OPEN',
    ...extra,
  };
}

/*
 * A stand-in for `sonar api get`: records each endpoint and answers issues
 * and analyses from the given lists.
 */
function fakeServer({ issues = [], analyses = [], fail = false } = {}) {
  const calls = [];
  const get = (endpoint) => {
    calls.push(endpoint);
    if (fail) throw new ServerError('sonar api get /api/issues/search exited 1: HTTP 401');
    const url = new URL(endpoint, 'https://sonar.invalid');
    if (url.pathname === '/api/project_analyses/search') return { analyses };
    const keys = url.searchParams.get('componentKeys').split(',');
    const hits = issues.filter((i) => keys.includes(i.component) || keys.includes(KEY));
    return { paging: { total: hits.length }, issues: hits };
  };
  return { get, calls };
}

test('server issues for the named files, with the impact severity and issue key', (t) => {
  const repo = boundRepo(t);
  const { get, calls } = fakeServer({
    issues: [
      serverIssue('.github/workflows/publish.yml', 'githubactions:S8541', 44),
      serverIssue('.github/workflows/publish.yml', 'githubactions:S8544', 49, {
        impacts: [{ softwareQuality: 'SECURITY', severity: 'LOW' }],
        severity: 'MINOR',
      }),
      serverIssue('src/other.py', 'python:S1', 1),
    ],
    analyses: [{ date: '2026-10-29T10:00:00+0000', revision: repo.revision }],
  });
  const result = serverResult({
    files: [repo.workflow],
    minSeverity: 'HIGH',
    cwd: repo.dir,
    get,
  });

  assert.deepEqual(
    result.issues.map((i) => `${i.file}:${i.line} ${i.severity} ${i.rule}`),
    [
      '.github/workflows/publish.yml:44 HIGH githubactions:S8541',
      '.github/workflows/publish.yml:49 LOW githubactions:S8544',
    ],
  );
  assert.equal(result.issues[0].key, 'githubactions:S8541@.github/workflows/publish.yml:44');
  assert.equal(result.summary.queried, 1);
  assert.equal(result.summary.atOrAboveThreshold, 1);
  assert.equal(serverExitCode(result), 1);

  const search = new URL(calls[0], 'https://sonar.invalid').searchParams;
  assert.equal(search.get('componentKeys'), `${KEY}:.github/workflows/publish.yml`);
  assert.equal(search.get('organization'), 'acme');
  assert.equal(search.get('resolved'), 'false');
});

test('the result says which revision the server saw and what changed since', (t) => {
  const repo = boundRepo(t);
  fs.appendFileSync(repo.source, 'print(2)\n');
  const { get } = fakeServer({
    analyses: [{ date: '2026-10-29T10:00:00+0000', revision: repo.revision }],
  });
  const result = serverResult({
    files: [repo.workflow, repo.source],
    minSeverity: 'HIGH',
    cwd: repo.dir,
    get,
  });

  const [project] = result.projects;
  assert.equal(project.upToDate, true);
  assert.deepEqual(project.changedSinceAnalysis, ['src/app.py']);
  assert.equal(serverExitCode(result), 0);
  assert.match(
    renderServer(result, 'text'),
    /last analysis .* \(= HEAD\); changed since: src\/app\.py/,
  );
});

test('an analyzed revision missing from the clone reads as unknown, not unchanged', (t) => {
  const repo = boundRepo(t);
  const { get } = fakeServer({ analyses: [{ date: 'd', revision: 'f'.repeat(40) }] });
  const result = serverResult({ files: [repo.source], minSeverity: 'HIGH', cwd: repo.dir, get });
  assert.equal(result.projects[0].upToDate, false);
  assert.equal(result.projects[0].changedSinceAnalysis, null);
  assert.match(renderServer(result, 'text'), /changes unknown/);
});

test('branch and pull request scope every call', (t) => {
  const repo = boundRepo(t);
  const { get, calls } = fakeServer();
  serverResult({
    files: [repo.source],
    minSeverity: 'HIGH',
    cwd: repo.dir,
    options: { pullRequest: '42' },
    get,
  });
  for (const call of calls) {
    const search = new URL(call, 'https://sonar.invalid').searchParams;
    assert.equal(search.get('pullRequest'), '42');
    assert.equal(search.has('branch'), false);
  }
});

test('unbound files are skipped, and nothing bound is exit 2, never clean', (t) => {
  const dir = scratch(t);
  const file = write(dir, 'a.py', 'x\n');
  const { get, calls } = fakeServer();
  const result = serverResult({ files: [file], minSeverity: 'HIGH', cwd: dir, get });
  assert.equal(calls.length, 0);
  assert.deepEqual(result.skipped, [
    { file: 'a.py', reason: 'no .sonarlint/connectedMode.json binding' },
  ]);
  assert.equal(serverExitCode(result), 2);
});

test('a failed server call is reported and exits 2', (t) => {
  const repo = boundRepo(t);
  const result = serverResult({
    files: [repo.source],
    minSeverity: 'HIGH',
    cwd: repo.dir,
    get: fakeServer({ fail: true }).get,
  });
  assert.equal(result.failed[0].project, KEY);
  assert.match(renderServer(result, 'text'), /server query failed for acme_wiki: .*HTTP 401/);
  assert.equal(serverExitCode(result), 2);
});

test('many files read the whole project and keep only the ones asked for', (t) => {
  const repo = boundRepo(t);
  const files = Array.from({ length: 120 }, (_, i) => write(repo.dir, `gen/f${i}.py`, 'x\n'));
  const { get, calls } = fakeServer({
    issues: [serverIssue('gen/f7.py', 'python:S1', 3), serverIssue('elsewhere.py', 'python:S1', 1)],
  });
  const result = serverResult({ files, minSeverity: 'INFO', cwd: repo.dir, get });
  const search = new URL(calls[0], 'https://sonar.invalid').searchParams;
  assert.equal(search.get('componentKeys'), KEY);
  assert.deepEqual(
    result.issues.map((i) => i.file),
    ['gen/f7.py'],
  );
});

test('server command parses like files, with --branch or --pull-request', () => {
  const parsed = parseArgs(['server', '.github/', '--branch', 'main']);
  assert.equal(parsed.command, 'server');
  assert.deepEqual(parsed.paths, ['.github/']);
  assert.equal(parsed.options.branch, 'main');
  assert.equal(parseArgs(['server', 'a', '--pull-request=7']).options.pullRequest, '7');
  assert.throws(() => parseArgs(['server']), UsageError);
  assert.throws(
    () => parseArgs(['server', 'a', '--branch', 'b', '--pull-request', '1']),
    UsageError,
  );
});

test('end to end through a stand-in `sonar` binary', (t) => {
  const repo = boundRepo(t);
  const bin = write(
    scratch(t),
    'sonar',
    `#!/usr/bin/env node
const endpoint = process.argv[4];
if (endpoint.startsWith('/api/project_analyses/'))
  console.log(JSON.stringify({ analyses: [] }));
else
  console.log(JSON.stringify({ paging: { total: 1 }, issues: [${JSON.stringify(
    serverIssue('.github/workflows/publish.yml', 'githubactions:S8541', 44),
  )}] }));
`,
  );
  fs.chmodSync(bin, 0o755);
  const run = spawnSync(process.execPath, [CLI, 'server', '.github', '--format', 'json'], {
    cwd: repo.dir,
    encoding: 'utf8',
    env: { ...process.env, SONARLINT_SONAR_CLI: bin },
  });
  assert.equal(run.status, 1, run.stderr);
  const out = JSON.parse(run.stdout);
  assert.equal(out.issues[0].rule, 'githubactions:S8541');
  assert.equal(out.projects[0].analysis, null);

  const missing = spawnSync(process.execPath, [CLI, 'server', 'src'], {
    cwd: repo.dir,
    encoding: 'utf8',
    env: { ...process.env, SONARLINT_SONAR_CLI: path.join(repo.dir, 'no-such-sonar') },
  });
  assert.equal(missing.status, 2);
  assert.match(missing.stdout, /`sonar`\) is not installed/);
});
