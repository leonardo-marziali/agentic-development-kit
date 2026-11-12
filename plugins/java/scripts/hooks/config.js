'use strict';

/*
 * The project's opt-in file, `.claude/java-standards.json`. Its presence is
 * what turns the plugin's opinions on for a project: without it the hooks
 * stay silent apart from formatting with the project's own Eclipse profile.
 *
 * `include` / `exclude` use .gitignore semantics, so a brownfield project can
 * scope the standard to new code (a `v2` package) and leave the rest alone.
 */

const fs = require('node:fs');
const path = require('node:path');

const CONFIG_RELATIVE_PATH = path.join('.claude', 'java-standards.json');

function warn(message) {
  process.stderr.write(`java plugin: ${message}\n`);
}

function pick(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function stringList(value, fallback) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : fallback;
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

// "1.8" → 8, "11" / 11 → 11; anything else is reported and ignored.
function parseJavaVersion(value) {
  if (value === undefined || value === null) return null;
  const match = /^(?:1\.)?(\d+)$/.exec(String(value).trim());
  if (match) return Number(match[1]);
  warn(
    `ignoring javaVersion ${JSON.stringify(value)} in ${CONFIG_RELATIVE_PATH}: not a Java version.`,
  );
  return null;
}

function normalise(raw) {
  const formatter = raw.formatter || {};
  const checks = raw.checks || {};
  const nullaway = raw.nullaway || {};
  const archunit = raw.archunit || {};
  return {
    include: stringList(raw.include, ['**']),
    exclude: stringList(raw.exclude, []),
    formatter: {
      enabled: bool(formatter.enabled, true),
      profile: typeof formatter.profile === 'string' ? formatter.profile : null,
      scope: pick(formatter.scope, ['changed-lines', 'file'], 'changed-lines'),
    },
    checks: {
      enabled: bool(checks.enabled, true),
      disabledRules: stringList(checks.disabledRules, []),
    },
    nullaway: {
      enabled: bool(nullaway.enabled, true),
      annotations: pick(nullaway.annotations, ['auto', 'jspecify', 'spring'], 'auto'),
    },
    archunit: {
      enabled: bool(archunit.enabled, true),
      basePackage: typeof archunit.basePackage === 'string' ? archunit.basePackage : null,
      packages: stringList(archunit.packages, []),
      disabledRules: stringList(archunit.disabledRules, []),
      compile: pick(archunit.compile, ['auto', 'always', 'never'], 'auto'),
    },
    javaVersion: parseJavaVersion(raw.javaVersion),
  };
}

/*
 * A malformed file is treated as absent: a typo in the config must never trap
 * a session in a fix loop.
 */
function loadConfig(repoRoot) {
  const file = path.join(repoRoot, CONFIG_RELATIVE_PATH);
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    warn(`ignoring ${file}: ${err.message}`);
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    warn(`ignoring ${file}: expected a JSON object.`);
    return null;
  }
  return normalise(raw);
}

/*
 * One .gitignore line as a glob over repo-relative posix paths:
 *   - a leading `/` anchors it to the root; otherwise a pattern without an
 *     inner slash matches at any depth;
 *   - a trailing `/` matches everything below that directory.
 */
function toGlob(pattern) {
  let glob = pattern;
  const anchored = glob.startsWith('/');
  if (anchored) glob = glob.slice(1);
  const directory = glob.endsWith('/');
  if (directory) glob = glob.slice(0, -1);
  if (!anchored && !glob.includes('/') && !glob.startsWith('**')) glob = `**/${glob}`;
  return directory ? `${glob}/**` : glob;
}

// Last matching pattern wins, and `!` flips it — as in .gitignore.
function matchesPatterns(relPath, patterns) {
  let matched = false;
  for (const raw of patterns) {
    const negated = raw.startsWith('!');
    const pattern = negated ? raw.slice(1) : raw;
    if (!pattern) continue;
    const glob = toGlob(pattern);
    if (path.posix.matchesGlob(relPath, glob) || relPath === glob) matched = !negated;
  }
  return matched;
}

function toRepoRelativePosix(absPath, repoRoot) {
  const normalised = absPath.replaceAll('\\', '/');
  const root = repoRoot.replaceAll('\\', '/');
  const rel = path.posix.relative(root, normalised);
  return rel.startsWith('..') || path.posix.isAbsolute(rel) ? null : rel;
}

function isInScope(absPath, config, repoRoot) {
  const rel = toRepoRelativePosix(absPath, repoRoot);
  if (rel === null) return false;
  return matchesPatterns(rel, config.include) && !matchesPatterns(rel, config.exclude);
}

function findRepoRoot(startPath) {
  let dir = path.resolve(startPath);
  try {
    if (!fs.statSync(dir).isDirectory()) dir = path.dirname(dir);
  } catch {
    dir = path.dirname(dir);
  }
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Every default, as for an empty config file (the /java:check CLI in a project that didn't opt in).
function defaultConfig() {
  return normalise({});
}

module.exports = {
  CONFIG_RELATIVE_PATH,
  loadConfig,
  defaultConfig,
  isInScope,
  findRepoRoot,
  toGlob,
};
