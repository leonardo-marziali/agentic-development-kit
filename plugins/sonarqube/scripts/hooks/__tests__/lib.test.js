'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  isAnalyzable,
  analysisDepth,
  issuesBlockSession,
  gitIgnoreStatus,
  FALLBACK_EXCLUDED_DIRS,
} = require('../lib');
const { mkScratchDir, rmScratchDir } = require('./helpers');

/*
 * Scope is decided by git, so these build a real throwaway repository rather
 * than mocking it — the whole point of the change is that `.gitignore` is the
 * authority, and only real git can prove we read it correctly.
 */
function mkRepo(t, gitignore) {
  const dir = mkScratchDir('sonar-repo-test-');
  t.after(() => rmScratchDir(dir));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  if (gitignore) fs.writeFileSync(path.join(dir, '.gitignore'), gitignore);
  return dir;
}

function writeFile(dir, relative, contents = 'x') {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

test('a tracked source file is in scope', (t) => {
  const repo = mkRepo(t, 'node_modules/\n');
  assert.equal(isAnalyzable(writeFile(repo, 'src/app.ts')), true);
});

test('a brand-new untracked file is in scope (the question is ignored, not tracked)', (t) => {
  const repo = mkRepo(t, 'dist/\n');
  /*
   * Files Claude has just written are untracked by definition; scoping to
   * tracked files would exclude exactly the ones this plugin exists to check.
   */
  assert.equal(isAnalyzable(writeFile(repo, 'brand-new.ts')), true);
});

test('a gitignored file is out of scope', (t) => {
  const repo = mkRepo(t, 'dist/\ncoverage/\n');
  assert.equal(isAnalyzable(writeFile(repo, 'dist/bundle.js')), false);
  assert.equal(isAnalyzable(writeFile(repo, 'coverage/lcov.info')), false);
});

test("a project's own unusual ignore entry is honoured, with no list to update", (t) => {
  /*
   * The case a hardcoded directory list always gets wrong: nobody would have
   * thought to hardcode "generated-protos" or "artifacts".
   */
  const repo = mkRepo(t, 'generated-protos/\nartifacts/\n*.bundle.js\n');
  assert.equal(isAnalyzable(writeFile(repo, 'generated-protos/api_pb.ts')), false);
  assert.equal(isAnalyzable(writeFile(repo, 'artifacts/report.xml')), false);
  assert.equal(isAnalyzable(writeFile(repo, 'app.bundle.js')), false);
  assert.equal(isAnalyzable(writeFile(repo, 'app.js')), true);
});

test('a directory named node_modules is in scope when the repo does not ignore it', (t) => {
  /*
   * The flip side: the repository is the authority, not our opinion of it.
   */
  const repo = mkRepo(t, '');
  assert.equal(isAnalyzable(writeFile(repo, 'node_modules/left-pad/index.js')), true);
});

test('git internals are never in scope', (t) => {
  const repo = mkRepo(t, '');
  assert.equal(isAnalyzable(path.join(repo, '.git', 'config')), false);
});

test('any extension is in scope — no language filter', (t) => {
  const repo = mkRepo(t, '');
  for (const name of ['app.ts', 'main.tf', '.env', 'Dockerfile', 'notes']) {
    assert.equal(isAnalyzable(writeFile(repo, name)), true, `${name} should be in scope`);
  }
});

test('gitIgnoreStatus reports no repository outside one', (t) => {
  const dir = mkScratchDir('sonar-norepo-test-');
  t.after(() => rmScratchDir(dir));
  assert.deepEqual(gitIgnoreStatus(writeFile(dir, 'a.js')), { inRepo: false, ignored: false });
});

test('outside a repository, the heuristic fallback applies', (t) => {
  const dir = mkScratchDir('sonar-norepo-test-');
  t.after(() => rmScratchDir(dir));

  assert.equal(isAnalyzable(writeFile(dir, 'src/app.js')), true);
  for (const excluded of FALLBACK_EXCLUDED_DIRS) {
    assert.equal(
      isAnalyzable(writeFile(dir, path.join(excluded, 'thing.js'))),
      false,
      `${excluded} should be excluded by the fallback`,
    );
  }
});

test('the fallback covers ecosystems a node-only list would miss', (t) => {
  const dir = mkScratchDir('sonar-norepo-test-');
  t.after(() => rmScratchDir(dir));
  for (const relative of ['target/classes/A.class', 'vendor/lib/x.php', '.venv/lib/mod.py']) {
    assert.equal(isAnalyzable(writeFile(dir, relative)), false, `${relative} should be excluded`);
  }
});

test('the fallback does not exclude a path that merely contains the name', (t) => {
  const dir = mkScratchDir('sonar-norepo-test-');
  t.after(() => rmScratchDir(dir));
  assert.equal(isAnalyzable(writeFile(dir, 'src/dist-helpers.js')), true);
  assert.equal(isAnalyzable(writeFile(dir, 'src/build-config.ts')), true);
});

test('analysisDepth reads the plugin option and normalises case', (t) => {
  t.after(() => {
    delete process.env.CLAUDE_PLUGIN_OPTION_ANALYSIS_DEPTH;
  });

  process.env.CLAUDE_PLUGIN_OPTION_ANALYSIS_DEPTH = 'deep';
  assert.equal(analysisDepth(), 'DEEP');

  process.env.CLAUDE_PLUGIN_OPTION_ANALYSIS_DEPTH = ' STANDARD ';
  assert.equal(analysisDepth(), 'STANDARD');
});

test('analysisDepth falls back to the CLI default when unset or unrecognised', (t) => {
  t.after(() => {
    delete process.env.CLAUDE_PLUGIN_OPTION_ANALYSIS_DEPTH;
  });

  delete process.env.CLAUDE_PLUGIN_OPTION_ANALYSIS_DEPTH;
  assert.equal(analysisDepth(), null);

  process.env.CLAUDE_PLUGIN_OPTION_ANALYSIS_DEPTH = 'EXHAUSTIVE';
  assert.equal(analysisDepth(), null);
});

test('issuesBlockSession defaults to on and only an explicit "secrets" turns it off', (t) => {
  t.after(() => {
    delete process.env.CLAUDE_PLUGIN_OPTION_BLOCK_ON;
  });

  delete process.env.CLAUDE_PLUGIN_OPTION_BLOCK_ON;
  assert.equal(issuesBlockSession(), true);

  process.env.CLAUDE_PLUGIN_OPTION_BLOCK_ON = 'secrets-and-issues';
  assert.equal(issuesBlockSession(), true);

  process.env.CLAUDE_PLUGIN_OPTION_BLOCK_ON = 'Secrets';
  assert.equal(issuesBlockSession(), false);
});
