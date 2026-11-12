'use strict';

/*
 * A module's dependency classpath, for compiling changed files with NullAway.
 * It comes from the project's own build tool — Maven's
 * dependency:build-classpath, or a Gradle init script — so nothing is added
 * to the build files. The result is cached per hash of the build files (and
 * of the init script), so the build tool runs again only when they change.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { timeoutFor } = require('./budget');

const BUILD_TIMEOUT_MS = 120 * 1000;
const FAILURE_TTL_MS = 30 * 60 * 1000;
const INIT_SCRIPT = path.join(__dirname, 'print-classpath.gradle');
// Part of every cache key: a changed init script must not be served the old one's classpath.
const RESOLVER = fs.readFileSync(INIT_SCRIPT, 'utf8');
const OUTPUT_DIRS = [
  'target/classes',
  'target/test-classes',
  'build/classes/java/main',
  'build/classes/java/test',
];

function exists(file) {
  return fs.existsSync(file);
}

function buildTool(moduleRoot) {
  if (exists(path.join(moduleRoot, 'pom.xml'))) return 'maven';
  if (
    exists(path.join(moduleRoot, 'build.gradle')) ||
    exists(path.join(moduleRoot, 'build.gradle.kts'))
  ) {
    return 'gradle';
  }
  return null;
}

// The wrapper nearest the module, up to the repository root; else the tool on PATH.
function wrapper(moduleRoot, name, fallback) {
  let dir = moduleRoot;
  while (true) {
    const candidate = path.join(dir, process.platform === 'win32' ? `${name}.cmd` : name);
    if (exists(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (exists(path.join(dir, '.git')) || parent === dir) return fallback;
    dir = parent;
  }
}

// Everything that can change the classpath: the module's and the root's build files, the catalog,
// the JDK and the plugin's own resolver.
function cacheKey(moduleRoot, javaHome, resolver = RESOLVER) {
  const hash = crypto
    .createHash('sha256')
    .update(String(javaHome || ''))
    .update(resolver);
  const candidates = [];
  for (let dir = moduleRoot; ; dir = path.dirname(dir)) {
    for (const name of [
      'pom.xml',
      'build.gradle',
      'build.gradle.kts',
      'settings.gradle',
      'settings.gradle.kts',
    ]) {
      candidates.push(path.join(dir, name));
    }
    candidates.push(path.join(dir, 'gradle', 'libs.versions.toml'));
    if (exists(path.join(dir, '.git')) || path.dirname(dir) === dir) break;
  }
  for (const file of candidates.filter(exists)) {
    hash.update(file);
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

function run(bin, args, { cwd, javaHome }) {
  const env = { ...process.env };
  if (javaHome) {
    env.JAVA_HOME = javaHome;
    env.PATH = `${path.join(javaHome, 'bin')}${path.delimiter}${env.PATH || ''}`;
  }
  return spawnSync(bin, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: timeoutFor(BUILD_TIMEOUT_MS),
    maxBuffer: 32 * 1024 * 1024,
  });
}

function failure(result) {
  if (result.error) return result.error.message;
  return `${result.stdout || ''}${result.stderr || ''}`.trim().split('\n').slice(-15).join('\n');
}

function maven(moduleRoot, javaHome) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'java-plugin-cp-'));
  try {
    const output = path.join(dir, 'classpath.txt');
    const result = run(
      wrapper(moduleRoot, 'mvnw', 'mvn'),
      [
        '-q',
        '-B',
        'dependency:build-classpath',
        '-Dmdep.includeScope=test',
        `-Dmdep.outputFile=${output}`,
      ],
      { cwd: moduleRoot, javaHome },
    );
    if (result.error || result.status !== 0 || !exists(output)) return { error: failure(result) };
    const text = fs.readFileSync(output, 'utf8').trim();
    return { classpath: text ? text.split(path.delimiter) : [], processorPath: [] };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function gradle(moduleRoot, javaHome) {
  const result = run(
    wrapper(moduleRoot, 'gradlew', 'gradle'),
    [
      '-q',
      '--console=plain',
      '--no-configuration-cache',
      '-I',
      INIT_SCRIPT,
      `-PjavaPluginModule=${moduleRoot}`,
      '-p',
      moduleRoot,
      'printJavaPluginClasspath',
    ],
    { cwd: moduleRoot, javaHome },
  );
  if (result.error || result.status !== 0) return { error: failure(result) };
  const lines = result.stdout.split('\n');
  const pick = (prefix) => [
    ...new Set(
      lines.filter((l) => l.startsWith(`${prefix} `)).map((l) => l.slice(prefix.length + 1).trim()),
    ),
  ];
  return { classpath: pick('CP'), processorPath: pick('AP') };
}

function recentFailure(file) {
  try {
    return Date.now() - fs.statSync(file).mtimeMs < FAILURE_TTL_MS;
  } catch {
    return false;
  }
}

function resolveClasspath({ moduleRoot, cacheDir, javaHome = null, warn = () => {} }) {
  const tool = buildTool(moduleRoot);
  if (!tool) return null;
  const outputDirs = OUTPUT_DIRS.map((rel) => path.join(moduleRoot, rel)).filter(exists);

  const cacheFile = path.join(cacheDir, `${cacheKey(moduleRoot, javaHome)}.json`);
  try {
    return { ...JSON.parse(fs.readFileSync(cacheFile, 'utf8')), outputDirs };
  } catch {
    // not cached yet
  }

  /*
   * A failure is remembered too, so a module that can't resolve (a sibling
   * SNAPSHOT that isn't installed, say) doesn't cost a full build-tool run on
   * every stop. It is retried when the build files change or after a while.
   */
  const failFile = cacheFile.replace(/\.json$/, '.failed');
  if (recentFailure(failFile)) {
    warn(
      `classpath resolution for ${moduleRoot} failed recently; skipping NullAway there until its build files change ` +
        `or ${FAILURE_TTL_MS / 60000} minutes pass.`,
    );
    return null;
  }

  const resolved = tool === 'maven' ? maven(moduleRoot, javaHome) : gradle(moduleRoot, javaHome);
  if (resolved.error !== undefined) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(failFile, resolved.error);
    warn(
      `could not resolve the classpath of ${moduleRoot} with ${tool}; skipping NullAway there:\n${resolved.error}`,
    );
    return null;
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(resolved));
  return { ...resolved, outputDirs };
}

module.exports = { resolveClasspath, buildTool, cacheKey, recentFailure, FAILURE_TTL_MS };
