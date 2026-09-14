'use strict';

/*
 * Adapter over the SonarQube CLI (`sonar`). Everything the hooks know about
 * invoking, locating and interpreting that binary lives here, so the loop in
 * check-and-loop.js only ever deals with normalised outcomes.
 *
 * The CLI is a prerequisite, not something this plugin installs. It is also
 * genuinely optional at runtime: a missing `sonar` makes every hook no-op.
 */

const os = require('node:os');
const path = require('node:path');
const { resolveBin, runBin } = require('@leonardo-marziali/ad-lfl-kit');

/*
 * Documented `sonar` exit codes. 51 is the one that matters most: it means
 * the analysis ran successfully and found something, which is the only
 * signal this plugin treats as a reason to keep the session going.
 */
const EXIT_CLEAN = 0;
const EXIT_FAILED = 1;
const EXIT_INVALID_OPTIONS = 2;
const EXIT_FINDINGS = 51;
const EXIT_INTERRUPTED = 130;

/*
 * Hooks are spawned without a login shell, so PATH is frequently missing the
 * directories a user's shell profile would have added — which is exactly where
 * a CLI like `sonar` tends to live. Probe the inherited PATH first (it is
 * right when it is there), then the shim directories the common installers
 * use, so a working `sonar` isn't reported as missing just because the hook
 * didn't get a full environment.
 */
function sonarSearchDirs() {
  const home = os.homedir();
  return [
    ...(process.env.PATH || '').split(path.delimiter).filter(Boolean),
    path.join(home, '.local', 'bin'),
    path.join(home, '.local', 'share', 'mise', 'shims'),
    path.join(home, '.sonar', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ];
}

function resolveSonarBin() {
  return resolveBin('sonar', { extraDirs: sonarSearchDirs() });
}

/*
 * resolveBin falls back to the bare name when it finds nothing, and a bare
 * name is indistinguishable from "not installed" until something tries to
 * spawn it. Since every search dir is absolute, an absolute result means the
 * binary was actually located on disk.
 */
function sonarAvailable() {
  return path.isAbsolute(resolveSonarBin());
}

function runSonar(args, { cwd } = {}) {
  return runBin('sonar', args, {
    cwd,
    encoding: 'utf8',
    extraDirs: sonarSearchDirs(),
  });
}

/*
 * Turns a spawn result into one of a handful of outcomes the loop knows how
 * to act on. The distinction that matters is "the analysis ran and found
 * something" (block) versus "the analysis could not run" (report, never
 * block) — conflating the two would let an expired token silently trap a
 * session, or a real finding silently pass.
 */
function classify(result, label) {
  const report = `${result.stdout || ''}${result.stderr || ''}`.trim();

  if (result.error) {
    return { kind: 'unavailable', status: null, label, report: result.error.message };
  }

  switch (result.status) {
    case EXIT_FINDINGS:
      return { kind: 'findings', status: result.status, label, report };
    case EXIT_CLEAN:
      return { kind: 'clean', status: result.status, label, report };
    case EXIT_INVALID_OPTIONS:
      return { kind: 'invalid-options', status: result.status, label, report };
    case EXIT_INTERRUPTED:
      return { kind: 'interrupted', status: result.status, label, report };
    case EXIT_FAILED:
      return { kind: 'failed', status: result.status, label, report };
    default:
      /*
       * An undocumented code (or null, when the process was killed — the 180s
       * hook timeout, say) is treated as a failed run rather than a clean one.
       */
      return { kind: 'failed', status: result.status, label, report };
  }
}

/*
 * Secrets detection is the stage this plugin always runs and always blocks on.
 *
 * The scan itself is local — verified against CLI 1.7.0, it still reports
 * findings with an unreachable server configured, so no code leaves the
 * machine and no round trip can make it flaky. What it does still need is for
 * the CLI to be authenticated: `sonar analyze` refuses to run at all without
 * credentials, exiting 1 before it scans anything. So an unauthenticated CLI
 * means no gating, not silent gating — which is why every non-clean outcome
 * gets reported rather than swallowed.
 */
function analyzeSecrets(paths, { cwd } = {}) {
  return classify(runSonar(['analyze', 'secrets', ...paths], { cwd }), 'secrets');
}

/*
 * Full analysis. Deliberately never gated on SONARQUBE_CLI_TOKEN or any other
 * environment variable: credentials may equally have been persisted by
 * `sonar auth login`, and checking the environment would wrongly skip
 * analysis for a CLI that is perfectly well authenticated. Attempt it and let
 * the exit code say what happened.
 */
function analyzeFull(files, { projectKey, depth, cwd } = {}) {
  const args = ['analyze'];
  for (const file of files) {
    args.push('--file', file);
  }
  if (projectKey) args.push('--project', projectKey);
  if (depth) args.push('--depth', depth);
  /*
   * --force skips the CLI's large-change-set confirmation prompt. A hook has
   * no TTY to answer it on, so without this a big session would sit on the
   * prompt until the 180s hook timeout killed it.
   */
  args.push('--force', '--format', 'json');

  return classify(runSonar(args, { cwd }), 'analysis');
}

module.exports = {
  EXIT_CLEAN,
  EXIT_FAILED,
  EXIT_INVALID_OPTIONS,
  EXIT_FINDINGS,
  EXIT_INTERRUPTED,
  sonarSearchDirs,
  resolveSonarBin,
  sonarAvailable,
  runSonar,
  classify,
  analyzeSecrets,
  analyzeFull,
};
