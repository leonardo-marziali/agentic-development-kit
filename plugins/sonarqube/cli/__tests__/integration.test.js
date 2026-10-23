'use strict';

/*
 * End to end against a real SLOOP: starts a daemon over a throwaway git
 * project with known issues and checks the rule keys that come back.
 *
 * Needs an install (node scripts/install-sloop.js). Uses $SONARLINT_HOME, or
 * the CLI's default data dir; skips with a message when there's no install,
 * so the unit suite still runs anywhere. CI installs first, so it runs there.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { dataDir: resolveDataDir } = require('../paths');
const { readInstall } = require('../provision');

const CLI = path.join(__dirname, '..', 'sonarlint.js');
const DATA_DIR = resolveDataDir();
const installed = readInstall(DATA_DIR);
const skip = installed
  ? false
  : `SLOOP is not installed in ${DATA_DIR}; run node scripts/install-sloop.js to enable`;

/*
 * Credentials are generated per run, never committed: a literal token in the
 * repo would trip every secret scanner pointed at it, this plugin included.
 */
function fakeGithubToken() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return `ghp_${Array.from(crypto.randomBytes(36), (b) => alphabet[b % alphabet.length]).join('')}`;
}

function cli(cwd, args, input) {
  const result = spawnSync(process.execPath, [CLI, ...args, '--data-dir', DATA_DIR], {
    cwd,
    input,
    encoding: 'utf8',
    timeout: 240_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test(
  'SLOOP reports the expected rules on a fixture project',
  { skip, timeout: 300_000 },
  async (t) => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sonarlint-it-')));
    t.after(() => {
      cli(root, ['daemon', 'stop']);
      fs.rmSync(root, { recursive: true, force: true });
    });
    execFileSync('git', ['init', '-q', root]);
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(
      path.join(root, 'src', 'app.js'),
      'function compute(a) {\n  const unused = 42;\n  return a * 2;\n}\nmodule.exports = { compute };\n',
    );
    fs.writeFileSync(
      path.join(root, 'src', 'job.py'),
      'def run(task):\n    try:\n        return task()\n    except:\n        return None\n',
    );
    fs.writeFileSync(
      path.join(root, 'src', 'config.ts'),
      `export const token = "${fakeGithubToken()}";\n`,
    );
    fs.writeFileSync(path.join(root, 'src', 'clean.py'), 'def add(a, b):\n    return a + b\n');

    const files = cli(root, ['files', 'src', '--format', 'json', '--min-severity', 'HIGH']);
    assert.equal(files.status, 1, files.stderr);
    const result = JSON.parse(files.stdout);
    const rules = new Set(result.issues.map((i) => `${i.file} ${i.rule}`));

    assert.ok(rules.has('src/app.js javascript:S1481'), [...rules].join('\n'));
    assert.ok(rules.has('src/job.py python:S5754'), [...rules].join('\n'));
    assert.ok(rules.has('src/config.ts secrets:S6689'), [...rules].join('\n'));
    assert.equal(result.summary.analyzed, 4);
    assert.equal(result.summary.clean, 1);
    assert.equal(result.issues[0].severity, 'BLOCKER', 'the secret sorts first');
    assert.equal(result.issues.find((i) => i.rule === 'python:S5754').hasQuickFix, true);

    const below = cli(root, ['files', 'src/app.js', '--format', 'json', '--min-severity', 'HIGH']);
    assert.equal(below.status, 0, 'issues below the threshold exit 0');

    const stdin = cli(
      root,
      ['stdin', '--path', 'src/new.py', '--format', 'json'],
      'try:\n    pass\nexcept:\n    pass\n',
    );
    assert.equal(stdin.status, 1, stdin.stderr);
    const stdinIssues = JSON.parse(stdin.stdout).issues;
    assert.ok(stdinIssues.every((i) => i.file === 'src/new.py'));
    assert.ok(
      stdinIssues.some((i) => i.rule === 'python:S5754'),
      stdin.stdout,
    );
    assert.equal(
      fs.existsSync(path.join(root, 'src', 'new.py')),
      false,
      'stdin analysis writes nothing',
    );

    const escape = cli(root, ['stdin', '--path', '../outside.py'], 'x = 1\n');
    assert.equal(escape.status, 2);
    assert.match(escape.stderr, /outside the project root/);

    const rule = cli(root, ['rules', '--key', 'python:S5754']);
    assert.equal(rule.status, 0, rule.stderr);
    assert.match(rule.stdout, /^python:S5754 — /);

    const doctor = cli(root, ['doctor']);
    assert.equal(doctor.status, 0, doctor.stdout);
    assert.match(doctor.stdout, /ok {3}daemon: pid \d+, ready/);
  },
);
