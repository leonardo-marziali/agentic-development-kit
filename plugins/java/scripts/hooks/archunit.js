'use strict';

/*
 * The ArchUnit section of the Stop loop: the plugin's runner over each
 * touched module's compiled classes, with the standard's rules plus the
 * project's own from .claude/archunit/. Nothing lives in the project's build
 * or test sources, so a project's own ArchUnit tests are unaffected.
 *
 * Findings aren't scoped to changed lines: ArchUnit scopes by package
 * (`archunit.packages`) and, for brownfield code, by the freeze store in
 * .claude/archunit-store/<module>/, which only /java:setup creates.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { timeoutFor } = require('./budget');
const { buildTool, cacheKey, recentFailure } = require('./classpath');
const { buildJavaHome } = require('./module');
const { registerSection } = require('./sections');

const RUNNER_CLASS = 'dev.adk.java.archunit.Runner';
const COMPILE_TIMEOUT_MS = 120 * 1000;
const RUNNER_TIMEOUT_MS = 90 * 1000;
const OUTPUT_DIRS = [
  'target/classes',
  'target/test-classes',
  'build/classes/java/main',
  'build/classes/java/test',
];
const SOURCE_ROOTS = ['src/main/java', 'src/test/java'];
const MAX_CLASS_FILES = 50000;

function outputDirsOf(moduleRoot) {
  return OUTPUT_DIRS.map((rel) => path.join(moduleRoot, rel)).filter((dir) => fs.existsSync(dir));
}

// The newest .class file under the output dirs, or 0 when there are none.
function newestClass(outputDirs) {
  let newest = 0;
  let seen = 0;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (seen > MAX_CLASS_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.class')) {
        seen += 1;
        newest = Math.max(newest, fs.statSync(full).mtimeMs);
      }
    }
  };
  outputDirs.forEach(walk);
  return newest;
}

function wrapperFor(moduleRoot, name, fallback) {
  for (let dir = moduleRoot; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
    if (fs.existsSync(path.join(dir, '.git')) || path.dirname(dir) === dir) return fallback;
  }
}

function compileModule(moduleRoot, javaHome) {
  const tool = buildTool(moduleRoot);
  const [bin, args] =
    tool === 'gradle'
      ? [
          wrapperFor(moduleRoot, 'gradlew', 'gradle'),
          ['-q', '-p', moduleRoot, 'classes', 'testClasses'],
        ]
      : [wrapperFor(moduleRoot, 'mvnw', 'mvn'), ['-q', '-B', 'compile', 'test-compile']];
  const env = { ...process.env };
  if (javaHome) {
    env.JAVA_HOME = javaHome;
    env.PATH = `${path.join(javaHome, 'bin')}${path.delimiter}${env.PATH || ''}`;
  }
  return spawnSync(bin, args, {
    cwd: moduleRoot,
    env,
    encoding: 'utf8',
    timeout: timeoutFor(COMPILE_TIMEOUT_MS),
    maxBuffer: 32 * 1024 * 1024,
  });
}

/*
 * Where a failed compile is remembered: keyed by the build files and the
 * session's sources (contents' mtimes), so any edit retries it.
 */
function compileFailureFile(moduleRoot, trackedSources, javaHome) {
  const stamp = trackedSources.map((file) => `${file}@${fs.statSync(file).mtimeMs}`).join('|');
  const key = crypto
    .createHash('sha256')
    .update(cacheKey(moduleRoot, javaHome))
    .update(stamp)
    .digest('hex');
  const base =
    process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.cache', 'claude-java-plugin');
  return path.join(base, 'compile-failures', `${key}.failed`);
}

/*
 * Makes the module's classes current enough to analyse: `auto` compiles only
 * when a tracked source is newer than every class, `always` compiles every
 * time, `never` skips a module whose classes are missing or stale.
 */
/*
 * One build per module at a time: parallel subagent stops would otherwise run
 * two Maven or Gradle builds into the same target/. The lock holds the
 * owner's pid, and a lock whose owner is gone is taken over.
 */
function buildLockFile(moduleRoot) {
  const base =
    process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.cache', 'claude-java-plugin');
  const key = crypto.createHash('sha256').update(path.resolve(moduleRoot)).digest('hex');
  return path.join(base, 'build-locks', `${key.slice(0, 16)}.lock`);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// A release function, or null while a live session holds the lock.
function acquireBuildLock(moduleRoot) {
  const lock = buildLockFile(moduleRoot);
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
      return () => fs.rmSync(lock, { force: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const owner = Number(fs.readFileSync(lock, 'utf8'));
      if (Number.isInteger(owner) && owner > 0 && isAlive(owner)) return null;
      fs.rmSync(lock, { force: true });
    }
  }
  return null;
}

function ensureCompiled({ moduleRoot, trackedSources, mode, javaHome, warn }) {
  const outputDirs = outputDirsOf(moduleRoot);
  const newest = outputDirs.length > 0 ? newestClass(outputDirs) : 0;
  const stale = newest === 0 || trackedSources.some((file) => fs.statSync(file).mtimeMs > newest);
  if (mode === 'never' && stale) {
    warn(
      `${moduleRoot}: compiled classes are missing or older than the sources (archunit.compile: never); skipping ArchUnit there.`,
    );
    return 'skipped';
  }
  if (mode !== 'always' && !stale) return 'fresh';
  const failFile = compileFailureFile(moduleRoot, trackedSources, javaHome);
  if (recentFailure(failFile)) {
    warn(
      `compiling ${moduleRoot} failed recently and nothing changed since; skipping ArchUnit there.`,
    );
    return 'skipped';
  }
  const release = acquireBuildLock(moduleRoot);
  if (!release) {
    warn(`another session is compiling ${moduleRoot}; skipping ArchUnit there this time.`);
    return 'skipped';
  }
  let result;
  try {
    result = compileModule(moduleRoot, javaHome);
  } finally {
    release();
  }
  if (result.error || result.status !== 0) {
    fs.mkdirSync(path.dirname(failFile), { recursive: true });
    fs.writeFileSync(failFile, String(result.status));
    const output = result.error
      ? result.error.message
      : `${result.stdout || ''}${result.stderr || ''}`.trim().split('\n').slice(-15).join('\n');
    warn(`could not compile ${moduleRoot} for ArchUnit; skipping it there:\n${output}`);
    return 'skipped';
  }
  return 'compiled';
}

// .claude/archunit/*.java compiled against the plugin's ArchUnit jars, or null.
function compileProjectRules(repoRoot, manifest, warn) {
  const dir = path.join(repoRoot, '.claude', 'archunit');
  const sources = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((name) => name.endsWith('.java'))
        .map((name) => path.join(dir, name))
    : [];
  if (sources.length === 0) return null;
  const hash = crypto.createHash('sha256');
  for (const file of sources) hash.update(file).update(fs.readFileSync(file));
  const base =
    process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.cache', 'claude-java-plugin');
  const outDir = path.join(base, 'archunit-extra', hash.digest('hex').slice(0, 16));
  // Written last: a directory without it is what a killed compile left behind.
  const complete = path.join(outDir, '.complete');
  if (fs.existsSync(complete)) return outDir;
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const result = spawnSync(
    manifest.javac,
    ['-nowarn', '-d', outDir, '-cp', manifest.jars.archunit.join(path.delimiter), ...sources],
    { encoding: 'utf8', timeout: timeoutFor(COMPILE_TIMEOUT_MS) },
  );
  if (result.error || result.status !== 0) {
    fs.rmSync(outDir, { recursive: true, force: true });
    warn(
      `could not compile the project's ArchUnit rules in .claude/archunit/:\n${(result.stderr || result.error?.message || '').slice(-2000)}`,
    );
    return null;
  }
  fs.writeFileSync(complete, '');
  return outDir;
}

function runnerCommand(manifest) {
  if (process.env.JAVA_PLUGIN_ARCHUNIT_CMD)
    return { bin: process.env.JAVA_PLUGIN_ARCHUNIT_CMD, prefix: [] };
  if (!manifest?.classes?.archunit) return null;
  const classpath = [manifest.classes.archunit, ...manifest.jars.archunit].join(path.delimiter);
  return { bin: manifest.javaBin, prefix: ['-cp', classpath, RUNNER_CLASS] };
}

// "com/acme/Foo.java" → the module's source file when it exists there.
function sourceFile(moduleRoot, rel) {
  if (rel === '-') return moduleRoot;
  for (const root of SOURCE_ROOTS) {
    const candidate = path.join(moduleRoot, root, rel);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(moduleRoot, rel);
}

function parseRunner(stdout, moduleRoot, warn) {
  const findings = [];
  for (const line of stdout.split(/\r?\n/)) {
    const fields = line.split('\t');
    if (fields[0] === 'FINDING' && fields.length >= 5) {
      findings.push({
        file: sourceFile(moduleRoot, fields[1]),
        line: Number(fields[2]),
        rule: fields[3],
        message: fields.slice(4).join('\t'),
      });
    } else if (fields[0] === 'ERROR' && fields.length >= 3) {
      warn(`ArchUnit: ${fields.slice(2).join('\t')}`);
    }
  }
  return findings;
}

function runnerArgs({ outputDirs, archunit, store, extra, createStore }) {
  const { packages, basePackage, disabledRules } = archunit;
  let scope = packages;
  if (scope.length === 0 && basePackage) scope = [`${basePackage}..`];
  const args = ['--classes', outputDirs.join(path.delimiter)];
  if (scope.length > 0) args.push('--packages', scope.join(','));
  if (basePackage) args.push('--base-package', basePackage);
  if (disabledRules.length > 0) args.push('--disabled', disabledRules.join(','));
  if (createStore) args.push('--store', store, '--create-store');
  else if (fs.existsSync(store)) args.push('--store', store);
  if (extra) args.push('--extra', extra);
  return args;
}

function runModule({ moduleRoot, module, command, archunit, store, extra, createStore, warn }) {
  const state = ensureCompiled({
    moduleRoot,
    trackedSources: module.files,
    mode: archunit.compile,
    javaHome: buildJavaHome(module.info.javaLevel, { warn }),
    warn,
  });
  const outputDirs = outputDirsOf(moduleRoot);
  if (state === 'skipped' || outputDirs.length === 0) return { findings: [], analysed: false };

  const result = spawnSync(
    command.bin,
    [...command.prefix, ...runnerArgs({ outputDirs, archunit, store, extra, createStore })],
    {
      encoding: 'utf8',
      timeout: timeoutFor(RUNNER_TIMEOUT_MS),
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.error || (result.status !== 0 && !result.stdout)) {
    warn(
      `ArchUnit could not run on ${moduleRoot}: ${result.error?.message || (result.stderr || '').trim().slice(-2000)}`,
    );
    return { findings: [], analysed: false };
  }
  return { findings: parseRunner(result.stdout, moduleRoot, warn), analysed: true };
}

/*
 * Each module gets its own freeze store: ArchUnit keys stored violations by
 * rule, so a store shared across modules would count one module's frozen
 * violations as solved while analysing another, and drop them.
 */
function moduleStore(repoRoot, moduleRoot) {
  const relative = path.relative(repoRoot, moduleRoot).split(path.sep).join('/');
  return path.join(repoRoot, '.claude', 'archunit-store', relative || 'root');
}

function runSection({ repoRoot, config, modules, manifest, warn, createStore = false }) {
  if (!config.archunit.enabled) return { findings: [], analysed: 0 };
  const command = runnerCommand(manifest);
  if (!command) return { findings: [], analysed: 0 };

  const extra = manifest?.javac ? compileProjectRules(repoRoot, manifest, warn) : null;
  const findings = [];
  let analysed = 0;
  for (const [moduleRoot, module] of modules) {
    const result = runModule({
      moduleRoot,
      module,
      command,
      archunit: config.archunit,
      store: moduleStore(repoRoot, moduleRoot),
      extra,
      createStore,
      warn,
    });
    findings.push(...result.findings);
    if (result.analysed) analysed += 1;
  }
  return { findings, analysed };
}

registerSection({ name: 'ArchUnit', partition: 'files', run: runSection });

module.exports = {
  runSection,
  ensureCompiled,
  compileProjectRules,
  buildLockFile,
  parseRunner,
  RUNNER_CLASS,
};
