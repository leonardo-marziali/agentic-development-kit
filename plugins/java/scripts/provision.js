'use strict';

/*
 * Provisioning for the plugin's JVM tools: the Eclipse JDT engine, javac
 * with Error Prone + NullAway, the ArchUnit runner, and a fallback Lombok.
 * Every jar is pinned in engine.lock.json with an exact version and a
 * SHA-256; nothing here ever asks a repository for "latest".
 *
 * Fails closed, like the sonarqube plugin's provisioning it is modelled on:
 * a jar whose checksum doesn't match is deleted and the install stops, and
 * install.json is only written once every jar is verified and the engine's
 * own Java sources are compiled, so a half-finished install is never used.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const PLUGIN_ROOT = path.join(__dirname, '..');
const LOCK_FILE = path.join(PLUGIN_ROOT, 'engine.lock.json');
const ENGINE_SRC = path.join(PLUGIN_ROOT, 'engine');
const MANIFEST = 'install.json';
const DEFAULT_BASE_URL = 'https://repo1.maven.org/maven2';

// Which jar group each engine source directory compiles against.
const ENGINE_CLASSPATH = { jdt: ['jdt'], archunit: ['archunit'] };

class ChecksumError extends Error {}
class ProvisionError extends Error {}

function loadLock(file = LOCK_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function pluginVersion() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'),
    ).version;
  } catch {
    return 'unknown';
  }
}

function engineDataDir() {
  const base =
    process.env.CLAUDE_PLUGIN_DATA ||
    path.join(require('node:os').homedir(), '.cache', 'claude-java-plugin');
  return path.join(base, 'engine');
}

function artifactFileName({ artifactId, version }) {
  return `${artifactId}-${version}.jar`;
}

function artifactUrl(baseUrl, coords) {
  return `${baseUrl.replace(/\/$/, '')}/${coords.groupId.replaceAll('.', '/')}/${coords.artifactId}/${coords.version}/${artifactFileName(coords)}`;
}

function baseUrlFromEnv() {
  return process.env.JAVA_PLUGIN_ARTIFACT_BASE_URL || DEFAULT_BASE_URL;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verifyChecksum(file, expected, label) {
  const actual = sha256File(file);
  if (actual !== String(expected).toLowerCase()) {
    throw new ChecksumError(`checksum mismatch for ${label}: expected ${expected}, got ${actual}`);
  }
}

async function download(url, dest) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new ProvisionError(`download failed: ${url} → HTTP ${response.status}`);
  fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

/*
 * One pinned jar to `dest`, verified: an already-present file whose checksum
 * matches (re-runs are cheap), else `fromDir` (offline), else `baseUrl`. The
 * file reaches `dest` only after passing its checksum.
 */
async function obtain(coords, dest, { baseUrl, fromDir, log }) {
  const name = artifactFileName(coords);
  if (fs.existsSync(dest)) {
    try {
      verifyChecksum(dest, coords.sha256, name);
      return dest;
    } catch {
      fs.rmSync(dest, { force: true });
    }
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const partial = `${dest}.partial-${process.pid}`;
  try {
    if (fromDir) {
      const source = path.join(fromDir, name);
      if (!fs.existsSync(source))
        throw new ProvisionError(`offline install: ${name} not found in ${fromDir}`);
      fs.copyFileSync(source, partial);
    } else {
      const url = artifactUrl(baseUrl, coords);
      log(`fetching ${url}`);
      await download(url, partial);
    }
    verifyChecksum(partial, coords.sha256, name);
    fs.renameSync(partial, dest);
    log(`verified ${name}`);
    return dest;
  } finally {
    fs.rmSync(partial, { force: true });
  }
}

/*
 * Major version of a `java` binary, or null if it can't be run. The version
 * line is `openjdk version "21.0.5"` or the legacy `"1.8.0_402"`.
 */
function javaMajorVersion(javaBin) {
  const result = spawnSync(javaBin, ['-version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  const match = /version "(?:1\.)?(\d+)/.exec(`${result.stderr}${result.stdout}`);
  return match ? Number(match[1]) : null;
}

// The JDK the tools run on: JAVA_HOME, else `java` / `javac` on PATH.
function findJava() {
  const home = process.env.JAVA_HOME;
  const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name);
  const bin = home ? path.join(home, 'bin', exe('java')) : 'java';
  const javac = home ? path.join(home, 'bin', exe('javac')) : 'javac';
  const major = javaMajorVersion(bin);
  return major === null ? null : { bin, javac, major };
}

function listJavaSources(dir) {
  const out = [];
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.java')) out.push(full);
    }
  };
  walk(dir);
  return out.sort((a, b) => a.localeCompare(b));
}

/*
 * A digest of the engine's own Java sources: the compiled classes are only
 * current while it matches, so editing the engine invalidates the install.
 */
function sourceHash(engineSrc) {
  const hash = crypto.createHash('sha256');
  for (const file of listJavaSources(engineSrc)) {
    hash.update(path.relative(engineSrc, file));
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex');
}

function compileEngine({ name, sources, classpath, outDir, java }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const result = spawnSync(
    java.javac,
    [
      '--release',
      '21',
      '-nowarn',
      '-encoding',
      'UTF-8',
      '-d',
      outDir,
      '-cp',
      classpath.join(path.delimiter),
      ...sources,
    ],
    { encoding: 'utf8' },
  );
  if (result.error || result.status !== 0) {
    throw new ProvisionError(
      `compiling the ${name} engine failed:\n${(result.stderr || result.error?.message || '').slice(-4000)}`,
    );
  }
}

async function install({
  dataDir = engineDataDir(),
  lock = loadLock(),
  baseUrl = baseUrlFromEnv(),
  fromDir = null,
  engineSrc = ENGINE_SRC,
  java = findJava(),
  compile = compileEngine,
  log = () => {},
} = {}) {
  if (!java || java.major < lock.minJava) {
    const found = java ? `; found JDK ${java.major} at ${java.bin}` : '; none found';
    throw new ProvisionError(
      `JDK ${lock.minJava} or newer is required to run the java plugin's tools${found}. Set JAVA_HOME.`,
    );
  }

  const jars = {};
  for (const [group, entries] of Object.entries(lock.groups)) {
    jars[group] = [];
    for (const coords of entries) {
      const dest = path.join(dataDir, 'jars', group, artifactFileName(coords));
      jars[group].push(await obtain(coords, dest, { baseUrl, fromDir, log }));
    }
  }

  /*
   * Classes go in a directory named after the sources' hash, compiled aside
   * and renamed into place: a session still running the previous engine
   * keeps its classes while another session installs a new one.
   */
  const hash = sourceHash(engineSrc);
  const classes = {};
  for (const [name, groups] of Object.entries(ENGINE_CLASSPATH)) {
    const sources = listJavaSources(path.join(engineSrc, name, 'src'));
    if (sources.length === 0) continue;
    const outDir = path.join(dataDir, 'classes', `${name}-${hash.slice(0, 16)}`);
    if (!fs.existsSync(outDir)) {
      const partial = `${outDir}.partial-${process.pid}`;
      try {
        compile({
          name,
          sources,
          classpath: groups.flatMap((g) => jars[g] || []),
          outDir: partial,
          java,
        });
        try {
          fs.renameSync(partial, outDir);
        } catch (err) {
          // Another install finished the same classes first: theirs are identical.
          if (!fs.existsSync(outDir)) throw err;
        }
      } finally {
        fs.rmSync(partial, { recursive: true, force: true });
      }
      log(`compiled ${name} engine`);
    }
    classes[name] = outDir;
  }

  const manifest = {
    version: pluginVersion(),
    sourceHash: hash,
    javaBin: java.bin,
    javac: java.javac,
    javaMajor: java.major,
    jars,
    classes,
  };
  // Renamed into place so a reader never sees a half-written manifest.
  const manifestPartial = path.join(dataDir, `${MANIFEST}.partial-${process.pid}`);
  fs.writeFileSync(manifestPartial, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.renameSync(manifestPartial, path.join(dataDir, MANIFEST));
  return manifest;
}

/*
 * The current install's manifest, or null when there is none or it is stale:
 * a different plugin version, a jar the lock no longer pins, or engine
 * sources that changed since they were compiled.
 */
function readInstall(
  dataDir = engineDataDir(),
  { lock = loadLock(), engineSrc = ENGINE_SRC } = {},
) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dataDir, MANIFEST), 'utf8'));
  } catch {
    return null;
  }
  if (manifest.version !== pluginVersion() || manifest.sourceHash !== sourceHash(engineSrc))
    return null;
  // A JDK that was upgraded or removed since the install leaves nothing to run the tools with.
  for (const bin of [manifest.javaBin, manifest.javac]) {
    if (path.isAbsolute(bin) && !fs.existsSync(bin)) return null;
  }
  for (const [group, entries] of Object.entries(lock.groups)) {
    const expected = entries.map((coords) =>
      path.join(dataDir, 'jars', group, artifactFileName(coords)),
    );
    const actual = manifest.jars?.[group] || [];
    if (
      expected.length !== actual.length ||
      expected.some((jar, i) => jar !== actual[i] || !fs.existsSync(jar))
    ) {
      return null;
    }
  }
  return manifest;
}

module.exports = {
  LOCK_FILE,
  MANIFEST,
  ChecksumError,
  ProvisionError,
  loadLock,
  engineDataDir,
  artifactFileName,
  artifactUrl,
  findJava,
  javaMajorVersion,
  sourceHash,
  install,
  readInstall,
};
