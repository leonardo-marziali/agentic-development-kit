'use strict';

/*
 * Constants and small predicates shared by this plugin's hooks. The generic
 * loop machinery — hook input, session state, file tracking, the capped fix
 * loop, change scoping — comes from @leonardo-marziali/ad-lfl-kit; local
 * analysis goes through the plugin's own `sonarlint` CLI (cli/sonarlint.js),
 * and binding discovery lives in connected-mode.js.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runBin } = require('@leonardo-marziali/ad-lfl-kit');
const { rank } = require('../../cli/severity');

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
  const result = runBin('git', ['check-ignore', '--quiet', '--', absPath], {
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
 * `min_blocking_severity` in plugin.json's userConfig, surfaced to hooks as
 * CLAUDE_PLUGIN_OPTION_MIN_BLOCKING_SEVERITY. Secrets block under every
 * setting; "secrets-only" blocks on nothing else. Anything unrecognised
 * (including a plugin installed before the option existed) gets the default.
 */
const BLOCKING_LEVELS = {
  blocker: 'BLOCKER',
  high: 'HIGH',
  medium: 'MEDIUM',
  'secrets-only': null,
};
const DEFAULT_BLOCKING = 'high';

function blockingPolicy() {
  const raw = (process.env.CLAUDE_PLUGIN_OPTION_MIN_BLOCKING_SEVERITY || '').trim().toLowerCase();
  const key = Object.hasOwn(BLOCKING_LEVELS, raw) ? raw : DEFAULT_BLOCKING;
  return { key, threshold: BLOCKING_LEVELS[key] };
}

function isSecret(issue) {
  return String(issue.rule || '').startsWith('secrets:');
}

function blocks(issue, policy = blockingPolicy()) {
  if (isSecret(issue)) return true;
  return policy.threshold !== null && rank(issue.severity) >= rank(policy.threshold);
}

/*
 * `per_edit_feedback` (boolean, default true). Hooks receive it as a string.
 */
function perEditFeedbackEnabled() {
  const raw = (process.env.CLAUDE_PLUGIN_OPTION_PER_EDIT_FEEDBACK || '').trim().toLowerCase();
  return raw !== 'false' && raw !== '0';
}

/*
 * Runs the plugin's `sonarlint` CLI with node itself (process.execPath), so
 * it works without a PATH and on every platform. SONARLINT_CLI overrides the
 * script — the test suite's stand-in. The data dir reaches the CLI through
 * CLAUDE_PLUGIN_DATA, which Claude Code exports to hooks.
 */
const CLI_PATH = path.join(__dirname, '..', '..', 'cli', 'sonarlint.js');

function runSonarlint(args, { cwd, timeoutMs }) {
  return spawnSync(process.execPath, [process.env.SONARLINT_CLI || CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
}

/*
 * Parses `sonarlint files --format json` output. Exit 0/1 both mean the
 * analysis ran (1 = something at/above the threshold); anything else is the
 * tool failing, which the caller reports and never blocks on.
 */
function parseAnalysis(result) {
  if (result.error) return { ok: false, reason: result.error.message };
  if (result.status !== 0 && result.status !== 1) {
    return { ok: false, reason: (result.stderr || '').trim() || `exit ${result.status}` };
  }
  try {
    return { ok: true, result: JSON.parse(result.stdout) };
  } catch {
    return { ok: false, reason: 'unreadable output from sonarlint' };
  }
}

module.exports = {
  STATE_NAMESPACE,
  TOUCHED_FILES,
  OWN_STATE_FILES,
  FALLBACK_EXCLUDED_DIRS,
  gitIgnoreStatus,
  isAnalyzable,
  BLOCKING_LEVELS,
  blockingPolicy,
  isSecret,
  blocks,
  perEditFeedbackEnabled,
  CLI_PATH,
  runSonarlint,
  parseAnalysis,
};
