'use strict';

/*
 * The daemon's memory caps, from the plugin options down to what SLOOP gets:
 * the JVM's -Xmx, and the JS/TS bridge's maxspace on each analysis request.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { maxHeapMb, bridgeMaxHeapMb } = require('../client');
const { parseArgv } = require('../daemon');
const {
  Sloop,
  BridgeOutOfMemory,
  DEFAULT_MAX_HEAP_MB,
  DEFAULT_BRIDGE_MAX_HEAP_MB,
} = require('../sloop');

function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const UNSET = {
  SONARLINT_MAX_HEAP_MB: undefined,
  CLAUDE_PLUGIN_OPTION_DAEMON_MAX_HEAP_MB: undefined,
};

test('maxHeapMb defaults to the same value sloop.js uses', () => {
  withEnv(UNSET, () => assert.equal(maxHeapMb(), DEFAULT_MAX_HEAP_MB));
});

test('maxHeapMb reads the plugin option, and SONARLINT_MAX_HEAP_MB overrides it', () => {
  withEnv({ ...UNSET, CLAUDE_PLUGIN_OPTION_DAEMON_MAX_HEAP_MB: '1024' }, () =>
    assert.equal(maxHeapMb(), 1024),
  );
  withEnv({ SONARLINT_MAX_HEAP_MB: '512', CLAUDE_PLUGIN_OPTION_DAEMON_MAX_HEAP_MB: '1024' }, () =>
    assert.equal(maxHeapMb(), 512),
  );
});

test('maxHeapMb falls back to the default for values -Xmx would reject', () => {
  for (const bad of ['0', '-5', '1.5', 'lots']) {
    withEnv({ ...UNSET, SONARLINT_MAX_HEAP_MB: bad }, () =>
      assert.equal(maxHeapMb(), DEFAULT_MAX_HEAP_MB, bad),
    );
  }
});

test('the daemon takes --max-heap-mb, defaulting when it is missing or invalid', () => {
  const base = ['--root', '/r', '--data-dir', '/d'];
  assert.equal(parseArgv(base).maxHeapMb, DEFAULT_MAX_HEAP_MB);
  assert.equal(parseArgv([...base, '--max-heap-mb', '1536']).maxHeapMb, 1536);
  assert.equal(parseArgv([...base, '--max-heap-mb', 'x']).maxHeapMb, DEFAULT_MAX_HEAP_MB);
});

test(
  'SLOOP is spawned with -Xmx from maxHeapMb',
  { skip: process.platform === 'win32' },
  async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sloop-heap-'));
    try {
      // A stand-in java that records its arguments and exits, which makes
      // start() fail fast instead of waiting on an initialize reply.
      const argsFile = path.join(dir, 'args');
      const java = path.join(dir, 'java');
      fs.writeFileSync(java, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\nexit 3\n`, {
        mode: 0o755,
      });
      const manifest = { javaPath: java, backendDir: dir, mainClass: 'Main', analyzers: [] };
      const sloop = new Sloop({ manifest, root: dir, storageDir: dir, maxHeapMb: 640 });
      await assert.rejects(sloop.start({ readyTimeoutMs: 5000 }), /exited during startup/);
      const args = fs.readFileSync(argsFile, 'utf8').split('\n');
      assert.ok(args.includes('-Xmx640m'), args.join(' '));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test('bridgeMaxHeapMb reads its own option and falls back to its own default', () => {
  const unset = {
    SONARLINT_BRIDGE_MAX_HEAP_MB: undefined,
    CLAUDE_PLUGIN_OPTION_BRIDGE_MAX_HEAP_MB: undefined,
  };
  withEnv(unset, () => assert.equal(bridgeMaxHeapMb(), DEFAULT_BRIDGE_MAX_HEAP_MB));
  withEnv({ ...unset, CLAUDE_PLUGIN_OPTION_BRIDGE_MAX_HEAP_MB: '2048' }, () =>
    assert.equal(bridgeMaxHeapMb(), 2048),
  );
  withEnv({ ...unset, SONARLINT_BRIDGE_MAX_HEAP_MB: '1.5' }, () =>
    assert.equal(bridgeMaxHeapMb(), DEFAULT_BRIDGE_MAX_HEAP_MB),
  );
});

test('the daemon takes --bridge-max-heap-mb', () => {
  const base = ['--root', '/r', '--data-dir', '/d'];
  assert.equal(parseArgv(base).bridgeMaxHeapMb, DEFAULT_BRIDGE_MAX_HEAP_MB);
  assert.equal(parseArgv([...base, '--bridge-max-heap-mb', '3072']).bridgeMaxHeapMb, 3072);
});

/*
 * A Sloop wired to a fake JSON-RPC connection: records analysis requests, and
 * replays `logs` through SLOOP's own log handler before answering, the order
 * they arrive in on the real stream.
 */
function fakeSloop({ bridgeMaxHeapMb: cap, logs = [] }) {
  const sloop = new Sloop({ manifest: {}, root: '/r', storageDir: '/s', bridgeMaxHeapMb: cap });
  const notifications = new Map();
  const requests = [];
  sloop.connection = {
    onRequest() {},
    onNotification(method, handler) {
      if (typeof method === 'string') notifications.set(method, handler);
    },
    async sendNotification() {},
    async sendRequest(method, params) {
      requests.push({ method, params });
      for (const message of logs) notifications.get('log')({ level: 'ERROR', message });
      return { rawIssues: [], failedAnalysisFiles: [] };
    },
  };
  sloop.registerCallbacks(() => {});
  return { sloop, requests };
}

const ENTRY = { abs: '/r/a.js', content: 'let a = 1;\n' };

test('every analysis request carries the bridge cap as sonar.javascript.node.maxspace', async () => {
  const { sloop, requests } = fakeSloop({ bridgeMaxHeapMb: 1536 });
  await sloop.analyze([ENTRY]);
  const [analysis] = requests.filter((r) => r.method === 'analysis/analyzeFilesAndTrack');
  assert.deepEqual(analysis.params.extraProperties, {
    'sonar.javascript.node.maxspace': '1536',
  });
});

test('a bridge that ran out of memory fails the analysis instead of passing it as clean', async () => {
  const oom =
    'The analysis will stop due to the Node.js process running out of memory (heap size limit 448 MB)';
  const { sloop } = fakeSloop({ bridgeMaxHeapMb: 256, logs: [oom] });
  await assert.rejects(sloop.analyze([ENTRY]), (error) => {
    assert.ok(error instanceof BridgeOutOfMemory);
    assert.match(error.message, /256 MB/);
    assert.match(error.message, /bridge_max_heap_mb/);
    return true;
  });
});

test('the out-of-memory flag is per analysis, not sticky', async () => {
  const { sloop } = fakeSloop({ bridgeMaxHeapMb: 1024 });
  sloop.bridgeOutOfMemory = true;
  assert.deepEqual((await sloop.analyze([ENTRY])).failed, []);
});
