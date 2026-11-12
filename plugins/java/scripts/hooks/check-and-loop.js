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
  changedRangesByFile,
  scopesFor,
  partitionByScope,
  runFixLoop,
} = require('@leonardo-marziali/ad-lfl-kit');
const { STATE_NAMESPACE, TOUCHED_FILES, isJavaFile, isBuildFile, isTrackable } = require('./lib');
const { loadConfig, isInScope, findRepoRoot } = require('./config');
const { resolveProfile } = require('./profile');
const { moduleInfo } = require('./module');
const { runEngine } = require('./engine');
const { checkBuildFile } = require('./build-rules');
const { registeredSections } = require('./sections');
// Each of these registers its report section on load.
require('./nullaway');
require('./archunit');
const { readInstall } = require('../provision');

const OWN_STATE_FILES = [TOUCHED_FILES, 'attempts.json'];

const warned = new Set();
function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  process.stderr.write(`java plugin: ${message}\n`);
}

// The engine install, or a stand-in when JAVA_PLUGIN_ENGINE_CMD overrides it.
function engineManifest() {
  if (process.env.JAVA_PLUGIN_ENGINE_CMD) return {};
  const manifest = readInstall();
  if (!manifest) {
    warnOnce(
      'the Java engine is not installed (or needs a JDK 21+); skipping formatting and Java checks. Run /java:setup.',
    );
  }
  return manifest;
}

function moduleRootOf(file, repoRoot) {
  const { existsSync } = require('node:fs');
  let dir = path.dirname(file);
  while (dir.startsWith(repoRoot)) {
    if (
      ['pom.xml', 'build.gradle', 'build.gradle.kts'].some((name) =>
        existsSync(path.join(dir, name)),
      )
    ) {
      return dir;
    }
    if (dir === repoRoot) break;
    dir = path.dirname(dir);
  }
  return repoRoot;
}

function groupBy(items, keyOf) {
  const groups = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function nullnessMode(config) {
  if (!config) return 'off';
  return config.nullaway.enabled ? config.nullaway.annotations : 'off';
}

/*
 * What a repository's share of the session needs: its config and profile,
 * and its in-scope files grouped by module.
 */
function planRepo(repoRoot, files) {
  const config = loadConfig(repoRoot);
  const inScope = config ? files.filter((file) => isInScope(file, config, repoRoot)) : files;
  const formatterOn = !config || config.formatter.enabled;
  const profile = formatterOn ? resolveProfile({ repoRoot, config }) : null;
  const javaFiles = inScope.filter(isJavaFile);
  const modules = new Map();
  for (const [moduleRoot, moduleFiles] of groupBy(javaFiles, (file) =>
    moduleRootOf(file, repoRoot),
  )) {
    modules.set(moduleRoot, {
      files: moduleFiles,
      info: config || profile ? moduleInfo(moduleRoot, config) : null,
    });
  }
  return { repoRoot, config, profile, javaFiles, buildFiles: inScope.filter(isBuildFile), modules };
}

function formatRanges(files, config) {
  if (config?.formatter.scope === 'file') return new Map(files.map((file) => [file, '*']));
  const ranges = new Map();
  for (const [file, changed] of changedRangesByFile(files)) {
    ranges.set(file, changed.all ? '*' : changed.ranges);
  }
  return ranges;
}

// Step 1: one engine run per module, formatting and (when opted in) checking.
function engineFindings(repo, manifest) {
  const checking = Boolean(repo.config?.checks.enabled);
  if (!manifest || (!repo.profile && !checking)) return [];
  const findings = [];
  for (const [, module] of repo.modules) {
    const ranges = repo.profile ? formatRanges(module.files, repo.config) : new Map();
    const result = runEngine({
      manifest,
      files: module.files.map((file) => ({ path: file, ranges: ranges.get(file) ?? null })),
      profile: repo.profile,
      rules: checking,
      disabled: repo.config?.checks.disabledRules ?? [],
      source: module.info.javaLevel,
      boot: module.info.boot,
      nullness: nullnessMode(repo.config),
    });
    for (const error of result.errors) {
      warnOnce(
        `${error.path === '-' ? 'engine' : path.relative(repo.repoRoot, error.path)}: ${error.message}`,
      );
    }
    findings.push(...result.findings);
  }
  return findings;
}

function relative(repoRoot, file) {
  return path.relative(repoRoot, file) || file;
}

function formatFindings(repoRoot, findings) {
  return findings
    .map((f) => `- ${relative(repoRoot, f.file)}:${f.line} [${f.rule}] ${f.message}`)
    .join('\n');
}

function section(name, repoRoot, findings, { partition = true } = {}) {
  if (findings.length === 0) return null;
  if (!partition) return { name, repoRoot, blocking: findings, existing: [] };
  const scopes = scopesFor([...new Set(findings.map((f) => f.file))]);
  const { inScope, outOfScope } = partitionByScope(findings, { scopes });
  return { name, repoRoot, blocking: inScope, existing: outOfScope };
}

function check(repos, manifest) {
  const sections = [];
  for (const repo of repos) {
    const engine = engineFindings(repo, manifest);
    if (!repo.config) continue;
    sections.push(section('Source rules', repo.repoRoot, engine));
    const buildFindings = repo.config.checks.enabled
      ? repo.buildFiles.flatMap((file) =>
          checkBuildFile(file, require('node:fs').readFileSync(file, 'utf8')),
        )
      : [];
    sections.push(section('Build files', repo.repoRoot, buildFindings));
    for (const extra of registeredSections()) {
      const { findings } = extra.run({ ...repo, manifest, warn: warnOnce });
      sections.push(
        section(extra.name, repo.repoRoot, findings, { partition: extra.partition !== false }),
      );
    }
  }
  const present = sections.filter(Boolean);
  const failed = present.some((s) => s.blocking.length > 0);
  const report = present
    .filter((s) => s.blocking.length > 0 || s.existing.length > 0)
    .map((s) => {
      const parts = [`## ${s.name}`];
      if (s.blocking.length > 0) parts.push(formatFindings(s.repoRoot, s.blocking));
      if (s.existing.length > 0) {
        parts.push(`Already present (not blocking):\n${formatFindings(s.repoRoot, s.existing)}`);
      }
      return parts.join('\n\n');
    })
    .join('\n\n');
  return { failed, report };
}

const GUIDANCE = [
  "Fix the findings above in the lines you changed, following the project's Java standard",
  '(the java:* skills hold the full rules). When a rule genuinely does not apply, add',
  '`// java-rules:allow <ID> <reason>` on that line or the line above; the reason is required.',
].join(' ');

function buildMessage({ attempt, maxAttempts, outcome }) {
  return {
    stopReason: 'Java files touched in this session break the project Java standard.',
    systemMessage: [
      `The Java standard found issues in files edited this session (attempt ${attempt}/${maxAttempts}):`,
      outcome.report,
      `${GUIDANCE} After attempt ${maxAttempts} the loop stops and reports whatever is left.`,
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
