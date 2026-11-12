#!/usr/bin/env node
'use strict';

/*
 * Stop / SubagentStop hook. For the Java and build files this session (or
 * this subagent) touched:
 *
 *   1. one engine run per module formats the changed lines with the
 *      project's Eclipse profile (the plugin's default only in projects that
 *      opted in) and, in opted-in projects, checks the source rules;
 *   2. build files get the B2/B4 checks;
 *   3. registered sections (NullAway, ArchUnit) add their own findings.
 *
 * Findings on lines the session changed block the stop through ad-lfl-kit's
 * runFixLoop; older ones are listed but never block. Without
 * .claude/java-standards.json only step 1's formatting runs. A tool that
 * can't run warns on stderr and is skipped: a broken toolchain must not trap
 * the session.
 */

const path = require('node:path');
const {
  readHookInput,
  stateDir,
  loopStateDir,
  readTrackedFiles,
  trackSessionChanges,
  runFixLoop,
} = require('@leonardo-marziali/ad-lfl-kit');
const { STATE_NAMESPACE, TOUCHED_FILES, isTrackable } = require('./lib');
const { findRepoRoot } = require('./config');
const { engineManifest, groupBy, planRepo, check } = require('./pipeline');

const OWN_STATE_FILES = [TOUCHED_FILES, 'attempts.json'];

const INTRO =
  "Fix the findings above in the code you changed, following the project's Java standard " +
  '(the java:* skills hold the full rules).';

/*
 * How a finding that genuinely doesn't apply is set aside differs per tool,
 * so the message names only the ways that work for the sections that block.
 */
const EXCEPTIONS = {
  'Source rules':
    'Source rules: when one genuinely does not apply, add `// java-rules:allow <ID> <reason>` on that line or the line above; the reason is required.',
  'Build files':
    'Build files: fix the build file; if the user decides a rule does not fit the project, it goes in `checks.disabledRules` in .claude/java-standards.json.',
  NullAway:
    'NullAway: fix the nullness (annotate `@Nullable`, check for null, or return a value); only for a false positive, add `@SuppressWarnings("NullAway")` with a comment saying why.',
  ArchUnit:
    'ArchUnit: fix the design (layers, names, visibility); if the user decides a rule does not fit the project, it goes in `archunit.disabledRules` in .claude/java-standards.json, or existing violations go in the baseline (`/java:setup`).',
};

function guidance(sections) {
  return [INTRO, ...sections.map((name) => EXCEPTIONS[name]).filter(Boolean)].join('\n');
}

function buildMessage({ attempt, maxAttempts, outcome }) {
  return {
    stopReason: 'Java files touched in this session break the project Java standard.',
    systemMessage: [
      `The Java standard found issues in files edited this session (attempt ${attempt}/${maxAttempts}):`,
      outcome.report,
      guidance(outcome.blockingSections || []),
      `After attempt ${maxAttempts} the loop stops and reports whatever is left.`,
    ].join('\n\n'),
  };
}

function giveUp({ outcome, maxAttempts }) {
  process.stderr.write(
    `java plugin: Java standard findings remain after ${maxAttempts} fix attempts; leaving them in place.\n${outcome.report}\n`,
  );
}

function main() {
  const input = readHookInput();
  if (!input) return;

  const sessionDir = stateDir({ sessionId: input.session_id, namespace: STATE_NAMESPACE });
  trackSessionChanges({
    input,
    listFile: path.join(sessionDir, TOUCHED_FILES),
    matches: isTrackable,
  });

  const dir = loopStateDir({ dir: sessionDir, input });
  const files = readTrackedFiles(path.join(dir, TOUCHED_FILES));
  const byRepo = groupBy(files, (file) => findRepoRoot(file));
  byRepo.delete(null);

  let repos = null;
  let manifest = null;
  const result = runFixLoop({
    input,
    dir,
    stateFiles: OWN_STATE_FILES,
    files,
    check: () => {
      repos ??= [...byRepo].map(([repoRoot, repoFiles]) => planRepo(repoRoot, repoFiles));
      if (repos.some((repo) => repo.javaFiles.length > 0 && (repo.config || repo.profile))) {
        manifest ??= engineManifest();
      }
      return check(repos, manifest);
    },
    onCap: giveUp,
    buildMessage,
  });

  if (result.reason === 'error') {
    process.stderr.write(
      `java plugin: check failed: ${result.error.stack || result.error.message}\n`,
    );
  }
}

main();
