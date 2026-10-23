'use strict';

/*
 * Provisioning for SLOOP (sonarlint-backend-cli) and the analyzer jars it
 * loads. Everything is pinned in sloop.lock.json — exact versions and a
 * SHA-256 per file — and nothing here ever asks a repository for "latest".
 *
 * Fails closed: a file whose checksum doesn't match is deleted and the install
 * stops. A half-written install is never left where the daemon would find it,
 * because the manifest (install.json) is only written once every artifact has
 * been verified and unpacked.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const LOCK_FILE = path.join(__dirname, '..', 'sloop.lock.json');
const MANIFEST = 'install.json';
const DEFAULT_BASE_URL = 'https://repo1.maven.org/maven2';
const MIN_JAVA = 17;

class ChecksumError extends Error {}
class ProvisionError extends Error {}

function loadLock(file = LOCK_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/*
 * Musl-based Linux (Alpine) can't run the glibc JRE the platform archives
 * bundle, so it gets the no-arch archive and a system Java instead.
 */
function isMusl() {
  if (process.platform !== 'linux') return false;
  try {
    return !process.report.getReport().header.glibcVersionRuntime;
  } catch {
    return false;
  }
}

function platformKey() {
  return isMusl() ? 'no-arch' : `${process.platform}-${process.arch}`;
}

function selectDistribution(lock, key = platformKey()) {
  const dists = lock.backend.distributions;
  const chosen = dists[key] ? key : 'no-arch';
  return { key: chosen, ...dists[chosen] };
}

function artifactFileName({ artifactId, version, classifier, extension = 'jar' }) {
  return `${artifactId}-${version}${classifier ? `-${classifier}` : ''}.${extension}`;
}

function artifactUrl(baseUrl, coords) {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/${coords.groupId.replace(/\./g, '/')}/${coords.artifactId}/${coords.version}/${artifactFileName(coords)}`;
}

function baseUrlFromEnv() {
  return process.env.SONARLINT_ARTIFACT_BASE_URL || DEFAULT_BASE_URL;
}

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

async function verifyChecksum(file, expected, label = path.basename(file)) {
  const actual = await sha256File(file);
  if (actual !== String(expected).toLowerCase()) {
    throw new ChecksumError(`checksum mismatch for ${label}: expected ${expected}, got ${actual}`);
  }
  return actual;
}

async function download(url, dest) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new ProvisionError(`download failed: ${url} → HTTP ${response.status}`);
  }
  const { Readable } = require('node:stream');
  const { pipeline } = require('node:stream/promises');
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(dest, { mode: 0o644 }));
}

/*
 * Gets one pinned artifact to `dest`, verified. Order: an already-present file
 * whose checksum matches (idempotent re-runs), then `fromDir` (offline install
 * from a directory holding the files under their Maven names), then the
 * repository at `baseUrl`. The file only reaches `dest` after it has passed
 * its checksum, so a mismatch can never leave an unverified artifact behind.
 */
async function obtain(
  coords,
  dest,
  { baseUrl = baseUrlFromEnv(), fromDir = null, log = () => {} } = {},
) {
  const name = artifactFileName(coords);
  if (fs.existsSync(dest)) {
    try {
      await verifyChecksum(dest, coords.sha256);
      log(`ok       ${name} (already present)`);
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
      log(`copied   ${name}`);
    } else {
      const url = artifactUrl(baseUrl, coords);
      log(`fetching ${url}`);
      await download(url, partial);
    }
    await verifyChecksum(partial, coords.sha256, name);
    fs.renameSync(partial, dest);
    log(`verified ${name}`);
    return dest;
  } finally {
    fs.rmSync(partial, { force: true });
  }
}

/*
 * Unpacks an archive with the platform's own tools, argv-only (no shell).
 * tar.gz is universal. A zip goes through bsdtar where `tar` is bsdtar
 * (macOS, Windows 10+), and `unzip` elsewhere — GNU tar can't read zip.
 */
function extract(archive, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  if (archive.endsWith('.tar.gz')) {
    execFileSync('tar', ['-xzf', archive, '-C', destDir], { stdio: 'pipe' });
    return;
  }
  const bsdtar = spawnSync('tar', ['-xf', archive, '-C', destDir], { stdio: 'pipe' });
  if (!bsdtar.error && bsdtar.status === 0) return;
  const unzip = spawnSync('unzip', ['-q', '-o', archive, '-d', destDir], { stdio: 'pipe' });
  if (unzip.error || unzip.status !== 0) {
    throw new ProvisionError(
      `could not unpack ${path.basename(archive)}: neither bsdtar nor unzip worked. Install unzip and retry.`,
    );
  }
}

function javaExecutable(dir) {
  return path.join(dir, 'jre', 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
}

/*
 * Major version of a Java runtime, or null if it can't be run. `java -version`
 * prints to stderr, as `openjdk version "21.0.10"` or the legacy `"1.8.0_x"`.
 */
function javaMajorVersion(javaBin) {
  const result = spawnSync(javaBin, ['-version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  const match = /version "(\d+)(?:\.(\d+))?/.exec(`${result.stderr}${result.stdout}`);
  if (!match) return null;
  const major = Number(match[1]);
  return major === 1 ? Number(match[2]) : major;
}

function systemJava() {
  return (
    process.env.SONARLINT_JAVA ||
    (process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : 'java')
  );
}

async function install({
  dataDir,
  lock = loadLock(),
  baseUrl = baseUrlFromEnv(),
  fromDir = null,
  distributionKey = platformKey(),
  log = () => {},
} = {}) {
  const dist = selectDistribution(lock, distributionKey);
  const backend = lock.backend;
  const backendDir = path.join(dataDir, 'sloop', `${backend.version}-${dist.classifier}`);
  const downloads = path.join(dataDir, 'downloads');

  let javaPath;
  if (!dist.bundledJre) {
    javaPath = systemJava();
    const major = javaMajorVersion(javaPath);
    if (!major || major < MIN_JAVA) {
      throw new ProvisionError(
        `no bundled JRE for this platform, and ${javaPath} is ${major ? `Java ${major}` : 'not runnable'}; ` +
          `SLOOP needs Java ${MIN_JAVA}+. Set SONARLINT_JAVA or JAVA_HOME.`,
      );
    }
  }

  const archive = await obtain(
    { ...backend, classifier: dist.classifier, extension: dist.extension, sha256: dist.sha256 },
    path.join(
      downloads,
      artifactFileName({ ...backend, classifier: dist.classifier, extension: dist.extension }),
    ),
    { baseUrl, fromDir, log },
  );

  const mainJar = path.join(backendDir, 'lib', `${backend.artifactId}-${backend.version}.jar`);
  if (!fs.existsSync(mainJar)) {
    const staging = `${backendDir}.staging-${process.pid}`;
    fs.rmSync(staging, { recursive: true, force: true });
    try {
      extract(archive, staging);
      if (!fs.existsSync(path.join(staging, 'lib', path.basename(mainJar)))) {
        throw new ProvisionError(
          `unexpected archive layout: ${path.basename(mainJar)} missing from lib/`,
        );
      }
      fs.rmSync(backendDir, { recursive: true, force: true });
      fs.renameSync(staging, backendDir);
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
    log(`unpacked ${path.relative(dataDir, backendDir)}`);
  }
  if (dist.bundledJre) javaPath = javaExecutable(backendDir);

  const analyzers = [];
  for (const analyzer of lock.analyzers) {
    const dest = path.join(dataDir, 'analyzers', artifactFileName(analyzer));
    await obtain(analyzer, dest, { baseUrl, fromDir, log });
    analyzers.push({
      key: analyzer.key,
      path: dest,
      sha256: analyzer.sha256,
      languages: analyzer.languages,
    });
  }

  const manifest = {
    backendVersion: backend.version,
    mainClass: backend.mainClass,
    distribution: dist.key,
    bundledJre: dist.bundledJre,
    backendDir,
    javaPath,
    analyzers,
    installedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dataDir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

/*
 * The manifest of the current install, or null. A manifest whose backend
 * version doesn't match the lock is stale (the plugin was updated past it)
 * and reads as "not installed", so the user is pointed at setup again rather
 * than running an analyzer set nobody pinned.
 */
function readInstall(dataDir, lock = loadLock()) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dataDir, MANIFEST), 'utf8'));
    if (manifest.backendVersion !== lock.backend.version) return null;
    const pinned = new Map(lock.analyzers.map((a) => [a.key, a.sha256]));
    if (manifest.analyzers.some((a) => pinned.get(a.key) !== a.sha256)) return null;
    return manifest;
  } catch {
    return null;
  }
}

module.exports = {
  LOCK_FILE,
  MANIFEST,
  DEFAULT_BASE_URL,
  MIN_JAVA,
  ChecksumError,
  ProvisionError,
  loadLock,
  platformKey,
  selectDistribution,
  artifactFileName,
  artifactUrl,
  baseUrlFromEnv,
  sha256File,
  verifyChecksum,
  obtain,
  extract,
  javaExecutable,
  javaMajorVersion,
  systemJava,
  install,
  readInstall,
};
