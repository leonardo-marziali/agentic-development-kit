'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sonar = require('../sonar');
const { mkScratchDir, rmScratchDir, installFakeSonar, readInvocations } = require('./helpers');

/*
 * classify() is pure, so it can be exercised directly on synthetic spawn
 * results — no fake binary needed for the exit-code mapping itself.
 */
test('classify maps exit 51 to findings', () => {
  const outcome = sonar.classify({ status: 51, stdout: 'secret found' }, 'secrets');
  assert.equal(outcome.kind, 'findings');
  assert.equal(outcome.label, 'secrets');
  assert.equal(outcome.report, 'secret found');
});

test('classify maps exit 0 to clean', () => {
  assert.equal(sonar.classify({ status: 0, stdout: '' }, 'analysis').kind, 'clean');
});

test('classify maps exit 1 to failed, not clean', () => {
  /*
   * Exit 1 is the unauthenticated/unreachable case. Treating it as clean
   * would silently disable the whole analysis stage.
   */
  assert.equal(
    sonar.classify({ status: 1, stderr: 'not authenticated' }, 'analysis').kind,
    'failed',
  );
});

test('classify maps exit 2 to invalid-options', () => {
  assert.equal(
    sonar.classify({ status: 2, stderr: 'unknown flag' }, 'analysis').kind,
    'invalid-options',
  );
});

test('classify maps exit 130 to interrupted', () => {
  assert.equal(sonar.classify({ status: 130 }, 'analysis').kind, 'interrupted');
});

test('classify maps a spawn error to unavailable', () => {
  const outcome = sonar.classify({ error: new Error('spawn ENOENT') }, 'secrets');
  assert.equal(outcome.kind, 'unavailable');
  assert.equal(outcome.status, null);
});

test('classify treats a killed process (null status) as failed, not clean', () => {
  assert.equal(sonar.classify({ status: null }, 'analysis').kind, 'failed');
});

test('classify joins stdout and stderr into one report', () => {
  const outcome = sonar.classify({ status: 51, stdout: 'out\n', stderr: 'err\n' }, 'secrets');
  assert.equal(outcome.report, 'out\nerr');
});

test('sonarSearchDirs probes PATH before the fixed install locations', (t) => {
  const original = process.env.PATH;
  t.after(() => {
    process.env.PATH = original;
  });
  process.env.PATH = ['/first', '/second'].join(path.delimiter);

  const dirs = sonar.sonarSearchDirs();

  assert.equal(dirs[0], '/first');
  assert.equal(dirs[1], '/second');
  assert.ok(dirs.includes('/opt/homebrew/bin'));
  assert.ok(dirs.includes('/usr/local/bin'));
});

test('sonarAvailable is false when nothing resolves, and resolveSonarBin gives the bare name', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const originalPath = process.env.PATH;
  const originalHome = process.env.HOME;
  t.after(() => {
    process.env.PATH = originalPath;
    process.env.HOME = originalHome;
  });

  process.env.PATH = scratch;
  process.env.HOME = scratch;

  if (sonar.sonarAvailable()) {
    /*
     * sonar.js also probes /opt/homebrew/bin and /usr/local/bin, which no
     * environment variable can redirect. A machine with the real CLI in one
     * of those cannot exercise the not-installed path.
     */
    t.skip('a real `sonar` is installed in a fixed system location');
    return;
  }

  assert.equal(sonar.resolveSonarBin(), 'sonar');
});

test('sonarAvailable is true and resolves to an absolute path when found', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const { binDir, binPath } = installFakeSonar(scratch);
  const originalPath = process.env.PATH;
  t.after(() => {
    process.env.PATH = originalPath;
  });
  process.env.PATH = [binDir, originalPath].filter(Boolean).join(path.delimiter);

  assert.equal(sonar.sonarAvailable(), true);
  assert.equal(sonar.resolveSonarBin(), binPath);
});

test('analyzeSecrets invokes `sonar analyze secrets <paths>` and reports findings', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const { binDir, logFile } = installFakeSonar(scratch, {
    secrets: { status: 51, stdout: 'AWS key detected' },
  });
  const originalPath = process.env.PATH;
  t.after(() => {
    process.env.PATH = originalPath;
  });
  process.env.PATH = [binDir, originalPath].filter(Boolean).join(path.delimiter);

  const outcome = sonar.analyzeSecrets(['/repo/a.js', '/repo/b.js'], { cwd: scratch });

  assert.equal(outcome.kind, 'findings');
  assert.equal(outcome.report, 'AWS key detected');
  const [call] = readInvocations(logFile);
  assert.deepEqual(call.argv, ['analyze', 'secrets', '/repo/a.js', '/repo/b.js']);
});

test('analyzeFull repeats --file, adds --project and --depth, and asks for json', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const { binDir, logFile } = installFakeSonar(scratch, { analysis: { status: 0 } });
  const originalPath = process.env.PATH;
  t.after(() => {
    process.env.PATH = originalPath;
  });
  process.env.PATH = [binDir, originalPath].filter(Boolean).join(path.delimiter);

  sonar.analyzeFull(['/repo/a.js', '/repo/b.js'], {
    projectKey: 'my-key',
    depth: 'DEEP',
    cwd: scratch,
  });

  const [call] = readInvocations(logFile);
  assert.deepEqual(call.argv, [
    'analyze',
    '--file',
    '/repo/a.js',
    '--file',
    '/repo/b.js',
    '--project',
    'my-key',
    '--depth',
    'DEEP',
    '--force',
    '--format',
    'json',
  ]);
});

test('analyzeFull omits --project and --depth when there is nothing to pass', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const { binDir, logFile } = installFakeSonar(scratch, { analysis: { status: 0 } });
  const originalPath = process.env.PATH;
  t.after(() => {
    process.env.PATH = originalPath;
  });
  process.env.PATH = [binDir, originalPath].filter(Boolean).join(path.delimiter);

  sonar.analyzeFull(['/repo/a.js'], { cwd: scratch });

  const [call] = readInvocations(logFile);
  assert.deepEqual(call.argv, ['analyze', '--file', '/repo/a.js', '--force', '--format', 'json']);
});

test('runSonar executes in the cwd it is given', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const { binDir, logFile } = installFakeSonar(scratch, { analysis: { status: 0 } });
  const originalPath = process.env.PATH;
  t.after(() => {
    process.env.PATH = originalPath;
  });
  process.env.PATH = [binDir, originalPath].filter(Boolean).join(path.delimiter);

  sonar.runSonar(['analyze'], { cwd: binDir });

  /*
   * realpath, because the child reports its cwd resolved: on macOS the
   * scratch dir lives under /var/folders, which is a symlink to /private/var.
   */
  assert.equal(readInvocations(logFile)[0].cwd, fs.realpathSync(binDir));
});
