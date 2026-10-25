'use strict';

/*
 * The CLI's side of the daemon socket: connect (starting the daemon if it
 * isn't running and the caller allows it), send one request, read one reply.
 */

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { daemonPaths, ensurePrivateDir } = require('./paths');
const { readInstall } = require('./provision');

const DAEMON_SCRIPT = path.join(__dirname, 'daemon.js');
const CONNECT_RETRY_MS = 200;
const START_TIMEOUT_MS = 30_000;

class DaemonNotRunning extends Error {}
class NotInstalled extends Error {}

function idleMinutes() {
  const raw = Number(
    process.env.SONARLINT_IDLE_MINUTES || process.env.CLAUDE_PLUGIN_OPTION_DAEMON_IDLE_MINUTES,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 30;
}

// A heap size in MB from the first variable that's set, else the fallback.
function heapMb(names, fallback) {
  const raw = Number(names.map((name) => process.env[name]).find(Boolean));
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

// The fallbacks mirror DEFAULT_MAX_HEAP_MB and DEFAULT_BRIDGE_MAX_HEAP_MB in
// sloop.js, which this module doesn't load.
function maxHeapMb() {
  return heapMb(['SONARLINT_MAX_HEAP_MB', 'CLAUDE_PLUGIN_OPTION_DAEMON_MAX_HEAP_MB'], 768);
}

function bridgeMaxHeapMb() {
  return heapMb(['SONARLINT_BRIDGE_MAX_HEAP_MB', 'CLAUDE_PLUGIN_OPTION_BRIDGE_MAX_HEAP_MB'], 1024);
}

/*
 * A daemon that gave up after SLOOP crashed twice leaves a marker. For a
 * while afterwards, analysis requests fail fast rather than respawning it;
 * an explicit `daemon start` (warm) clears it.
 */
const FAILED_MARKER_TTL_MS = 10 * 60_000;

function recentlyFailed(marker) {
  try {
    return Date.now() - fs.statSync(marker).mtimeMs < FAILED_MARKER_TTL_MS;
  } catch {
    return false;
  }
}

function connectOnce(socketPath) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(socketPath);
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

/*
 * Detached and unref'd so the daemon outlives the CLI invocation (and the
 * hook) that started it. Its own stdio goes nowhere; everything it has to say
 * goes to its log file in the private runtime dir.
 */
function spawnDaemon({ root, dataDir, warm = false }) {
  const args = [
    DAEMON_SCRIPT,
    '--root',
    root,
    '--data-dir',
    dataDir,
    '--idle-minutes',
    String(idleMinutes()),
    '--max-heap-mb',
    String(maxHeapMb()),
    '--bridge-max-heap-mb',
    String(bridgeMaxHeapMb()),
  ];
  if (warm) args.push('--warm');
  const child = spawn(process.execPath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: root,
  });
  child.unref();
  return child;
}

async function connect({
  root,
  dataDir,
  noStart = false,
  warm = false,
  startTimeoutMs = START_TIMEOUT_MS,
}) {
  const paths = daemonPaths(root);
  try {
    return await connectOnce(paths.socket);
  } catch (error) {
    if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error;
  }
  if (noStart) throw new DaemonNotRunning(`no daemon is running for ${root}`);
  if (!warm && recentlyFailed(paths.failed)) {
    throw new Error(
      `SLOOP crashed repeatedly for ${root} (${fs.readFileSync(paths.failed, 'utf8').trim()}). ` +
        'Check the log, then run `sonarlint daemon start` to try again.',
    );
  }
  fs.rmSync(paths.failed, { force: true });
  if (!readInstall(dataDir)) {
    throw new NotInstalled(
      `SLOOP is not installed (looked in ${dataDir}). Run /sonarqube:setup, or: node scripts/install-sloop.js`,
    );
  }

  ensurePrivateDir(paths.dir);
  spawnDaemon({ root, dataDir, warm });
  const deadline = Date.now() + startTimeoutMs;
  for (;;) {
    try {
      return await connectOnce(paths.socket);
    } catch (error) {
      if (Date.now() > deadline) {
        throw new Error(
          `the daemon did not start within ${startTimeoutMs / 1000}s; see ${paths.log}`,
          {
            cause: error,
          },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, CONNECT_RETRY_MS));
    }
  }
}

/*
 * Sends `payload` and resolves with the parsed reply. `timeoutMs` bounds the
 * whole exchange (queueing included), so a wedged daemon surfaces as an error
 * rather than a hook that hangs until Claude Code kills it.
 */
async function request(payload, { root, dataDir, noStart, warm, timeoutMs = 180_000 }) {
  const socket = await connect({ root, dataDir, noStart, warm });
  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`no reply from the daemon within ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
    });
    socket.on('end', () => {
      clearTimeout(timer);
      try {
        const reply = JSON.parse(buffer.trim());
        if (!reply.ok) reject(new Error(reply.error || 'daemon error'));
        else resolve(reply);
      } catch {
        reject(new Error('malformed reply from the daemon'));
      }
    });
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.end(`${JSON.stringify(payload)}\n`);
  });
}

function readPid(root) {
  try {
    return Number(fs.readFileSync(daemonPaths(root).pid, 'utf8').trim()) || null;
  } catch {
    return null;
  }
}

module.exports = {
  connect,
  request,
  spawnDaemon,
  readPid,
  idleMinutes,
  maxHeapMb,
  bridgeMaxHeapMb,
  DaemonNotRunning,
  NotInstalled,
  DAEMON_SCRIPT,
};
