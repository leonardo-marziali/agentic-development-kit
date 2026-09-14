'use strict';

/*
 * Constants and small predicates shared by this plugin's two hooks. The
 * generic loop machinery — hook input, session state, file tracking, the
 * capped fix loop, spawning CLI shims — comes from
 * @leonardo-marziali/ad-lfl-kit; the SonarQube-specific parts live in
 * sonar.js and connected-mode.js.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

/*
 * track-touched.js writes the list and check-and-loop.js reads it, so both
 * hooks must agree on where this session's state lives.
 */
const STATE_NAMESPACE = 'sonarqube-session-scope';
const TOUCHED_FILES = 'touched-files.txt';
const OWN_STATE_FILES = [TOUCHED_FILES, 'attempts.json'];

/*
 * Deliberately not a language or extension filter. Sonar supports a long and
 * growing list of languages, and secrets detection is content-based rather
 * than language-based — a leaked credential in a .env or a .tf file counts.
 */

/*
 * Scope follows git, the way SonarQube for IDE does: anything the repository
 * ignores is not this project's source and is not analysed.
 *
 * This is strictly better than naming directories. `.gitignore` already
 * describes precisely what a project considers generated or vendored, it is
 * maintained by the people who own the repository, and it covers the cases a
 * hardcoded list always misses — build/, target/, vendor/, .next/, a
 * project-specific output directory nobody else would think to list.
 *
 * Exit status: 0 the path is ignored, 1 it is not, 128 there is no repository
 * here (or git failed). Note the question is "ignored?", not "tracked?" — a
 * file Claude has just created is untracked but absolutely in scope.
 */
function gitIgnoreStatus(absPath) {
  const result = spawnSync('git', ['check-ignore', '--quiet', '--', absPath], {
    cwd: path.dirname(absPath),
    encoding: 'utf8',
  });
  if (result.error) return { inRepo: false, ignored: false };
  return { inRepo: result.status === 0 || result.status === 1, ignored: result.status === 0 };
}

/*
 * Fallback for a file that is in no git repository at all, where there is no
 * project-authored statement of what counts as source. These are the names
 * that are generated or vendored across essentially every ecosystem — a
 * heuristic, and only ever reached when the authoritative answer is missing.
 */
const FALLBACK_EXCLUDED_DIRS = new Set([
  'node_modules',
  'bower_components',
  'vendor',
  'dist',
  'build',
  'out',
  'target',
  'bin',
  'obj',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.venv',
  'venv',
  '__pycache__',
  '.gradle',
  '.tox',
  '.terraform',
]);

function isAnalyzable(filePath) {
  const resolved = path.resolve(filePath);
  const segments = resolved.split(path.sep);

  /*
   * Git's own object store is never source, and `git check-ignore` does not
   * report it as ignored, so it has to be excluded on its own.
   */
  if (segments.includes('.git')) return false;

  const { inRepo, ignored } = gitIgnoreStatus(resolved);
  if (inRepo) return !ignored;

  return !segments.some((segment) => FALLBACK_EXCLUDED_DIRS.has(segment));
}

/*
 * `analysis_depth` in plugin.json's userConfig, surfaced to hook processes as
 * CLAUDE_PLUGIN_OPTION_ANALYSIS_DEPTH. Anything unrecognised (including a
 * plugin installed before the option existed) falls back to the CLI's own
 * default by passing no --depth at all.
 */
function analysisDepth() {
  const raw = (process.env.CLAUDE_PLUGIN_OPTION_ANALYSIS_DEPTH || '').trim().toUpperCase();
  return raw === 'STANDARD' || raw === 'DEEP' ? raw : null;
}

/*
 * `block_on` in plugin.json's userConfig. Only an explicit "secrets" narrows
 * the loop to the local secrets scan; everything else (including unset) gets
 * the documented default, which also runs the full analysis.
 */
function issuesBlockSession() {
  const raw = (process.env.CLAUDE_PLUGIN_OPTION_BLOCK_ON || '').trim().toLowerCase();
  return raw !== 'secrets';
}

module.exports = {
  STATE_NAMESPACE,
  TOUCHED_FILES,
  OWN_STATE_FILES,
  FALLBACK_EXCLUDED_DIRS,
  gitIgnoreStatus,
  isAnalyzable,
  analysisDepth,
  issuesBlockSession,
};
