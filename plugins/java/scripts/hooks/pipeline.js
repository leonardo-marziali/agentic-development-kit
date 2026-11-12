'use strict';

/*
 * The shared pipeline behind the Stop hook and the /java:check and
 * /java:format CLIs: plan a repository's files (config, profile, modules),
 * run the engine per module (format + source rules), the build-file checks
 * and the registered sections (NullAway, ArchUnit), and render one report.
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  changedRangesByFile,
  scopesFor,
  partitionByScope,
} = require('@leonardo-marziali/ad-lfl-kit');
const { isJavaFile, isBuildFile } = require('./lib');
const { loadConfig, isInScope } = require('./config');
const { resolveProfile } = require('./profile');
const { moduleInfo } = require('./module');
const { runEngine } = require('./engine');
const { checkBuildFile } = require('./build-rules');
const { registeredSections } = require('./sections');
const { readInstall } = require('../provision');
const { timeLeft } = require('./budget');

// Below this much time left, the optional sections (NullAway, ArchUnit) are skipped.
const SECTION_MIN_MS = 20 * 1000;
// Each of these registers its report section on load.
require('./nullaway');
require('./archunit');

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
  let dir = path.dirname(file);
  while (dir.startsWith(repoRoot)) {
    if (
      ['pom.xml', 'build.gradle', 'build.gradle.kts'].some((name) =>
        fs.existsSync(path.join(dir, name)),
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
function planRepo(repoRoot, files, { config = loadConfig(repoRoot), format = true } = {}) {
  const inScope = config ? files.filter((file) => isInScope(file, config, repoRoot)) : files;
  const formatterOn = format && (!config || config.formatter.enabled);
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
      encoding: module.info.encoding,
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

/*
 * Splits a section's findings into what blocks and what was already there.
 * `partition: true` scopes to the lines the session changed; `'files'` (for
 * ArchUnit, whose findings carry no reliable line) to the files it touched.
 */
function section(name, repoRoot, findings, { partition = true, touched = [] } = {}) {
  if (findings.length === 0) return null;
  if (!partition) return { name, repoRoot, blocking: findings, existing: [] };
  if (partition === 'files') {
    const touchedSet = new Set(touched.map((file) => path.resolve(file)));
    const blocking = findings.filter((f) => touchedSet.has(path.resolve(f.file)));
    return { name, repoRoot, blocking, existing: findings.filter((f) => !blocking.includes(f)) };
  }
  const scopes = scopesFor([...new Set(findings.map((f) => f.file))]);
  const { inScope, outOfScope } = partitionByScope(findings, { scopes });
  return { name, repoRoot, blocking: inScope, existing: outOfScope };
}

function check(repos, manifest, { changedLinesOnly = true } = {}) {
  const sections = [];
  for (const repo of repos) {
    const engine = engineFindings(repo, manifest);
    if (!repo.config) continue;
    sections.push(section('Source rules', repo.repoRoot, engine, { partition: changedLinesOnly }));
    const buildFindings = repo.config.checks.enabled
      ? repo.buildFiles.flatMap((file) => checkBuildFile(file, fs.readFileSync(file, 'utf8')))
      : [];
    sections.push(
      section('Build files', repo.repoRoot, buildFindings, { partition: changedLinesOnly }),
    );
    for (const extra of registeredSections()) {
      if (timeLeft() < SECTION_MIN_MS) {
        warnOnce(
          `the time budget for this stop is used up; skipping ${extra.name} (it runs again on the next stop).`,
        );
        continue;
      }
      const { findings } = extra.run({ ...repo, manifest, warn: warnOnce });
      sections.push(
        section(extra.name, repo.repoRoot, findings, {
          partition: changedLinesOnly && (extra.partition ?? true),
          touched: repo.javaFiles,
        }),
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
  const blockingSections = [
    ...new Set(present.filter((s) => s.blocking.length > 0).map((s) => s.name)),
  ];
  return { failed, report, blockingSections };
}

module.exports = { warnOnce, engineManifest, moduleRootOf, groupBy, planRepo, check, formatRanges };
