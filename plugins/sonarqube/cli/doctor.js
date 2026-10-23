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
    const stale = fs.existsSync(path.join(dataDir, MANIFEST));
    checks.push({
      name: 'install',
      ok: false,
      detail: stale
        ? `${dataDir} holds an install that doesn't match sloop.lock.json (plugin updated?). Re-run setup.`
        : `SLOOP is not installed in ${dataDir}. Run /sonarqube:setup.`,
    });
    return checks;
  }
  checks.push({
    name: 'install',
    ok: true,
    detail: `sonarlint-backend-cli ${manifest.backendVersion} (${manifest.distribution}) in ${dataDir}`,
  });

  const major = javaMajorVersion(manifest.javaPath);
  checks.push({
    name: 'java',
    ok: Boolean(major && major >= MIN_JAVA),
    detail: major
      ? `Java ${major} at ${manifest.javaPath}${manifest.bundledJre ? ' (bundled)' : ''}`
      : `${manifest.javaPath} cannot be run`,
  });

  const mainJar = path.join(
    manifest.backendDir,
    'lib',
    `${lock.backend.artifactId}-${lock.backend.version}.jar`,
  );
  checks.push({
    name: 'backend jar',
    ok: fs.existsSync(mainJar),
    detail: fs.existsSync(mainJar) ? mainJar : `${mainJar} is missing; re-run setup`,
  });

  for (const analyzer of manifest.analyzers) {
    let ok = false;
    let detail;
    if (!fs.existsSync(analyzer.path)) {
      detail = `${analyzer.path} is missing; re-run setup`;
    } else {
      const actual = await sha256File(analyzer.path);
      ok = actual === analyzer.sha256;
      detail = ok
        ? `${path.basename(analyzer.path)} sha256 ok`
        : `${path.basename(analyzer.path)} checksum mismatch; re-run setup`;
    }
    checks.push({ name: `analyzer ${analyzer.key}`, ok, detail });
  }

  try {
    const status = await request(
      { op: 'status' },
      { root, dataDir, noStart: true, timeoutMs: 5000 },
    );
    const skipped = status.skippedLanguages.map((s) => `${s.language} (${s.reason})`).join(', ');
    checks.push({
      name: 'daemon',
      ok: status.state === 'ready' ? true : status.state === 'starting' ? null : false,
      detail:
        `pid ${status.pid}, ${status.state}, ${status.analyses} analyses, ${status.restarts} restarts` +
        (status.error ? `, error: ${status.error}` : '') +
        (skipped ? `, skipped analyzers: ${skipped}` : '') +
        `; log: ${status.log}`,
    });
  } catch (error) {
    checks.push({
      name: 'daemon',
      ok: error instanceof DaemonNotRunning ? null : false,
      detail:
        error instanceof DaemonNotRunning
          ? `not running for ${root} (starts on first analysis)`
          : `not answering: ${error.message}`,
    });
  }
  return checks;
}

function renderChecks(checks) {
  const mark = (ok) => (ok === true ? 'ok  ' : ok === false ? 'FAIL' : '--  ');
  return `${checks.map((c) => `${mark(c.ok)} ${c.name}: ${c.detail}`).join('\n')}\n`;
}

module.exports = { runDoctor, renderChecks, nodeCheck };
