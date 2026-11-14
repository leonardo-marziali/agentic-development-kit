'use strict';

/*
 * `sonarlint doctor`: every precondition for a working analysis, checked
 * independently so one failure doesn't hide the next. Each check yields
 * { name, ok, detail } — `ok: null` is informational (nothing wrong, nothing
 * to verify yet).
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  loadLock,
  readInstall,
  sha256File,
  javaMajorVersion,
  MIN_JAVA,
  MANIFEST,
} = require('./provision');
const { request, DaemonNotRunning } = require('./client');

const MIN_NODE_FOR_JS = [22, 12];

function nodeCheck() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const ok =
    major > MIN_NODE_FOR_JS[0] || (major === MIN_NODE_FOR_JS[0] && minor >= MIN_NODE_FOR_JS[1]);
  return {
    name: 'node',
    ok,
    detail: ok
      ? `${process.execPath} ${process.version}`
      : `${process.version} is too old for the JS/TS analyzer (needs >= ${MIN_NODE_FOR_JS.join('.')}); JS/TS files will be skipped`,
  };
}

async function runDoctor({ dataDir, root }) {
  const checks = [nodeCheck()];
  const lock = loadLock();
  const manifest = readInstall(dataDir, lock);

  if (!manifest) {
    checks.push(missingInstallCheck(dataDir));
    return checks;
  }
  checks.push(
    {
      name: 'install',
      ok: true,
      detail: `sonarlint-backend-cli ${manifest.backendVersion} (${manifest.distribution}) in ${dataDir}`,
    },
    javaCheck(manifest),
    backendJarCheck(manifest, lock),
    ...(await Promise.all(manifest.analyzers.map(analyzerCheck))),
    await daemonCheck({ root, dataDir }),
  );
  return checks;
}

function missingInstallCheck(dataDir) {
  const stale = fs.existsSync(path.join(dataDir, MANIFEST));
  return {
    name: 'install',
    ok: false,
    detail: stale
      ? `${dataDir} holds an install that doesn't match sloop.lock.json (plugin updated?). Re-run setup.`
      : `SLOOP is not installed in ${dataDir}. Run /sonarqube:setup.`,
  };
}

function javaCheck(manifest) {
  const major = javaMajorVersion(manifest.javaPath);
  if (!major) return { name: 'java', ok: false, detail: `${manifest.javaPath} cannot be run` };
  const bundled = manifest.bundledJre ? ' (bundled)' : '';
  return {
    name: 'java',
    ok: major >= MIN_JAVA,
    detail: `Java ${major} at ${manifest.javaPath}${bundled}`,
  };
}

function backendJarCheck(manifest, lock) {
  const mainJar = path.join(
    manifest.backendDir,
    'lib',
    `${lock.backend.artifactId}-${lock.backend.version}.jar`,
  );
  const ok = fs.existsSync(mainJar);
  return { name: 'backend jar', ok, detail: ok ? mainJar : `${mainJar} is missing; re-run setup` };
}

async function analyzerCheck(analyzer) {
  const name = `analyzer ${analyzer.key}`;
  if (!fs.existsSync(analyzer.path)) {
    return { name, ok: false, detail: `${analyzer.path} is missing; re-run setup` };
  }
  const ok = (await sha256File(analyzer.path)) === analyzer.sha256;
  const file = path.basename(analyzer.path);
  return { name, ok, detail: ok ? `${file} sha256 ok` : `${file} checksum mismatch; re-run setup` };
}

// `ready` is ok, `starting` is informational, anything else is a failure.
function daemonStateOk(state) {
  if (state === 'ready') return true;
  if (state === 'starting') return null;
  return false;
}

async function daemonCheck({ root, dataDir }) {
  try {
    const status = await request(
      { op: 'status' },
      { root, dataDir, noStart: true, timeoutMs: 5000 },
    );
    const skipped = status.skippedLanguages.map((s) => `${s.language} (${s.reason})`).join(', ');
    return {
      name: 'daemon',
      ok: daemonStateOk(status.state),
      detail:
        `pid ${status.pid}, ${status.state}, ${status.analyses} analyses, ${status.restarts} restarts` +
        (status.error ? `, error: ${status.error}` : '') +
        (skipped ? `, skipped analyzers: ${skipped}` : '') +
        `; log: ${status.log}`,
    };
  } catch (error) {
    const notRunning = error instanceof DaemonNotRunning;
    return {
      name: 'daemon',
      ok: notRunning ? null : false,
      detail: notRunning
        ? `not running for ${root} (starts on first analysis)`
        : `not answering: ${error.message}`,
    };
  }
}

function mark(ok) {
  if (ok === true) return 'ok  ';
  if (ok === false) return 'FAIL';
  return '--  ';
}

function renderChecks(checks) {
  const lines = checks.map((c) => `${mark(c.ok)} ${c.name}: ${c.detail}`);
  return `${lines.join('\n')}\n`;
}

module.exports = { runDoctor, renderChecks, nodeCheck };
