#!/usr/bin/env node
'use strict';

/*
 * Stop / SubagentStop hook: runs SonarQube analysis over only the files this
 * session touched (per track-touched.js) and, if anything is found, blocks the
 * stop with `decision: "continue"` so Claude is handed the findings and keeps
 * working on them.
 *
 * Unlike the markdown plugin's equivalent there is no `fix` pass: the `sonar`
 * CLI has no local auto-fix, so every finding is Claude's to resolve in the
 * source. For the same reason there is no auto-suppression at the attempt cap.
 * Writing NOSONAR comments on the way out would quietly bury exactly the
 * findings this plugin exists to surface, and a secret that has already
 * reached disk is never something a hook should be allowed to silence. At the
 * cap the loop reports what is left and lets the session end.
 *
 * Two stages, in order of how much they can be trusted to run:
 *
 *   1. Secrets — the scan is local (no code leaves the machine), so it is
 *      unaffected by an unreachable server. Always runs, always blocks.
 *   2. Full analysis — always attempted, never gated on environment
 *      variables (see sonar.js). Blocks on findings; an unauthenticated or
 *      unreachable server is reported to stderr and does not block.
 *
 * Neither stage runs at all on a CLI with no credentials configured: `sonar
 * analyze` exits 1 before scanning anything. That is reported prominently
 * rather than swallowed, because it means the session is not being gated —
 * and a hook that stays quiet in that state is worse than no hook at all.
 *
 * `sonar analyze` takes project context from its own process cwd, so files are
 * grouped by their nearest .sonarlint/connectedMode.json (see
 * connected-mode.js) and analysed per group with cwd set there.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  readHookInput,
  stateDir,
  readTrackedFiles,
  runFixLoop,
} = require('@leonardo-marziali/ad-lfl-kit');
const {
  STATE_NAMESPACE,
  TOUCHED_FILES,
  OWN_STATE_FILES,
  isAnalyzable,
  analysisDepth,
  issuesBlockSession,
} = require('./lib');
const { sonarAvailable, resolveSonarBin, analyzeSecrets, analyzeFull } = require('./sonar');
const { groupByBinding, describeGroup } = require('./connected-mode');

const PREFIX = 'sonarqube plugin:';

/*
 * Collects stderr notes and emits each distinct one only once per hook run —
 * an unreachable server would otherwise produce the same line for every
 * binding group.
 */
function createNotes() {
  const seen = new Set();
  return {
    add(message) {
      if (seen.has(message)) return;
      seen.add(message);
    },
    emit() {
      for (const message of seen) {
        process.stderr.write(`${PREFIX} ${message}\n`);
      }
    },
  };
}

/*
 * An analysis that did not find anything is not necessarily an analysis that
 * ran. Everything other than a clean exit gets explained on stderr, and none
 * of it blocks: a session must never be trapped by a broken toolchain, an
 * expired token, or a bug in this hook.
 */
function noteNonFinding(outcome, label, notes) {
  switch (outcome.kind) {
    case 'clean':
      return;
    case 'invalid-options':
      /*
       * Exit 2 means this hook built an argument list the CLI rejected —
       * our bug, not the user's code. Say so unmistakably rather than
       * letting it read as "nothing found".
       */
      notes.add(
        `BUG — \`sonar\` rejected the arguments this hook passed (exit 2) for ${label}. ` +
          `The ${outcome.label} stage did NOT run, so nothing was checked. ` +
          `Please report this with the following output:\n${outcome.report}`,
      );
      return;
    case 'unavailable':
      notes.add(
        `could not execute \`sonar\` for ${label}; skipping the ${outcome.label} stage ` +
          `(${outcome.report}).`,
      );
      return;
    case 'interrupted':
      notes.add(`the ${outcome.label} stage was interrupted for ${label}; not blocking.`);
      return;
    default:
      notes.add(
        `the ${outcome.label} stage could not complete for ${label} (exit ${outcome.status}) — ` +
          'the CLI most likely has no credentials configured, or the server is unreachable. ' +
          'Run `sonar auth login` to fix it. Not blocking the session on it' +
          (outcome.label === 'secrets'
            ? ', so NOTHING was scanned for secrets this session.'
            : '.') +
          (outcome.report ? `\n${outcome.report}` : ''),
      );
  }
}

function section(stage, label, report) {
  return `## ${stage} — ${label}\n\n${report || '(no output)'}`;
}

/*
 * runFixLoop's check: returns { failed, report }. `failed` is true only when
 * an analysis actually ran and actually found something.
 */
function analyze(groups, { depth, withIssues, notes }) {
  let failed = false;
  const sections = [];

  for (const group of groups) {
    const label = describeGroup(group);

    const secrets = analyzeSecrets(group.files, { cwd: group.dir });
    if (secrets.kind === 'findings') {
      failed = true;
      sections.push(section('Secrets', label, secrets.report));
    } else {
      noteNonFinding(secrets, label, notes);
    }

    if (!withIssues) continue;

    const issues = analyzeFull(group.files, {
      projectKey: group.binding?.projectKey,
      depth,
      cwd: group.dir,
    });
    if (issues.kind === 'findings') {
      failed = true;
      sections.push(section('Issues', label, issues.report));
    } else {
      noteNonFinding(issues, label, notes);
    }
  }

  return { failed, report: sections.join('\n\n').trim() };
}

function buildMessage({ attempt, maxAttempts, outcome }) {
  return {
    stopReason: 'Files touched in this session still have SonarQube findings.',
    systemMessage:
      'SonarQube analysis found unresolved findings in files edited this session ' +
      `(attempt ${attempt}/${maxAttempts}):\n\n${outcome.report}\n\n` +
      'Fix these in the source. A secret must be removed from the file entirely — ' +
      'move it to an environment variable or a secret store — and, because it has ' +
      'already been written to disk and may be in git history, tell the user it needs ' +
      'rotating. Do not silence anything with a NOSONAR comment or by rewriting code ' +
      'purely to dodge a rule; if a finding is a genuine false positive, say which one ' +
      'and why instead of suppressing it. ' +
      `After attempt ${maxAttempts} the loop stops and reports whatever is left.`,
  };
}

/*
 * runFixLoop's onCap: attempts have run out, so the stop goes through. Report
 * only — nothing is written to the user's files. See the header comment for
 * why auto-suppression is deliberately absent here.
 */
function giveUp({ maxAttempts, outcome }) {
  process.stderr.write(
    `${PREFIX} findings remain after ${maxAttempts} attempts; letting the session end ` +
      'without suppressing anything. Resolve these before committing — if any of them ' +
      'is a secret, treat it as leaked and rotate it:\n' +
      `${outcome.report}\n`,
  );
}

function main() {
  const input = readHookInput();
  if (!input) return;

  /*
   * A missing prerequisite must never block a session, so this is a plain
   * no-op with one line of explanation rather than an error.
   */
  if (!sonarAvailable()) {
    process.stderr.write(
      `${PREFIX} the \`sonar\` CLI was not found (looked for "${resolveSonarBin()}" on PATH and ` +
        'in the usual install locations), so no analysis ran. Install the SonarQube CLI to ' +
        "enable this plugin's hooks.\n",
    );
    return;
  }

  const dir = stateDir({ sessionId: input.session_id, namespace: STATE_NAMESPACE });
  const listFile = path.join(dir, TOUCHED_FILES);
  if (!fs.existsSync(listFile)) return;

  const files = readTrackedFiles(listFile).filter(isAnalyzable);
  const groups = groupByBinding(files, { fallbackDir: input.cwd || process.cwd() });
  const notes = createNotes();

  const result = runFixLoop({
    input,
    dir,
    stateFiles: OWN_STATE_FILES,
    files,
    check: () =>
      analyze(groups, { depth: analysisDepth(), withIssues: issuesBlockSession(), notes }),
    onCap: giveUp,
    buildMessage,
  });

  notes.emit();

  if (result.reason === 'error') {
    process.stderr.write(`${PREFIX} analysis invocation failed: ${result.error.message}\n`);
  }
}

main();
