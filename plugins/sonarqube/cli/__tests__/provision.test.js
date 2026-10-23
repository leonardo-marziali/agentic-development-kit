'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const p = require('../provision');
const { latestFrom } = require('../../scripts/check-updates');

const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provision-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the committed lock pins every artifact with a sha256, and every platform falls back to no-arch', () => {
  const lock = p.loadLock();
  const dists = lock.backend.distributions;
  for (const key of [
    'linux-x64',
    'linux-arm64',
    'darwin-x64',
    'darwin-arm64',
    'win32-x64',
    'no-arch',
  ]) {
    assert.match(dists[key].sha256, /^[0-9a-f]{64}$/, key);
  }
  assert.equal(dists['no-arch'].bundledJre, false);
  for (const analyzer of lock.analyzers) {
    assert.match(analyzer.sha256, /^[0-9a-f]{64}$/, analyzer.artifactId);
    assert.match(
      analyzer.version,
      /^\d+(\.\d+)+$/,
      'pins are exact versions, never ranges or LATEST',
    );
    assert.ok(analyzer.languages.length > 0);
  }
  assert.equal(p.selectDistribution(lock, 'sunos-sparc').key, 'no-arch');
  assert.equal(p.selectDistribution(lock, 'linux-arm64').classifier, 'linux_aarch64');
});

test('artifact names and URLs follow the Maven layout, honouring a mirror base URL', () => {
  const coords = {
    groupId: 'org.sonarsource.text',
    artifactId: 'sonar-text-plugin',
    version: '1.2.3',
  };
  assert.equal(p.artifactFileName(coords), 'sonar-text-plugin-1.2.3.jar');
  assert.equal(
    p.artifactFileName({ ...coords, classifier: 'linux_x64', extension: 'tar.gz' }),
    'sonar-text-plugin-1.2.3-linux_x64.tar.gz',
  );
  assert.equal(
    p.artifactUrl('https://nexus.example.com/repository/maven/', coords),
    'https://nexus.example.com/repository/maven/org/sonarsource/text/sonar-text-plugin/1.2.3/sonar-text-plugin-1.2.3.jar',
  );
});

test('verifyChecksum accepts a match and rejects a mismatch', async (t) => {
  const file = path.join(scratch(t), 'a.jar');
  fs.writeFileSync(file, 'hello');
  assert.equal(await p.verifyChecksum(file, sha256('hello')), sha256('hello'));
  await assert.rejects(p.verifyChecksum(file, sha256('other')), p.ChecksumError);
});

test('offline install: a matching file is copied in; a tampered one fails closed and leaves nothing', async (t) => {
  const dir = scratch(t);
  const from = path.join(dir, 'from');
  fs.mkdirSync(from);
  fs.writeFileSync(path.join(from, 'x-1.0.jar'), 'good');
  const coords = { groupId: 'g', artifactId: 'x', version: '1.0', sha256: sha256('good') };

  const dest = path.join(dir, 'out', 'x-1.0.jar');
  await p.obtain(coords, dest, { fromDir: from });
  assert.equal(fs.readFileSync(dest, 'utf8'), 'good');

  fs.writeFileSync(path.join(from, 'x-1.0.jar'), 'evil');
  const dest2 = path.join(dir, 'out2', 'x-1.0.jar');
  await assert.rejects(
    p.obtain(coords, dest2, { fromDir: from }),
    /checksum mismatch for x-1.0.jar/,
  );
  assert.deepEqual(
    fs.readdirSync(path.dirname(dest2)),
    [],
    'no partial or unverified file is left behind',
  );
});

test('an already-present file with the wrong checksum is replaced, not trusted', async (t) => {
  const dir = scratch(t);
  const from = path.join(dir, 'from');
  fs.mkdirSync(from);
  fs.writeFileSync(path.join(from, 'x-1.0.jar'), 'good');
  const dest = path.join(dir, 'x-1.0.jar');
  fs.writeFileSync(dest, 'stale');
  await p.obtain({ groupId: 'g', artifactId: 'x', version: '1.0', sha256: sha256('good') }, dest, {
    fromDir: from,
  });
  assert.equal(fs.readFileSync(dest, 'utf8'), 'good');
});

test('downloads come from the configured base URL and are verified', async (t) => {
  const dir = scratch(t);
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/repo/g/x/1.0/x-1.0.jar') res.end('payload');
    else res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const baseUrl = `http://127.0.0.1:${server.address().port}/repo`;

  const coords = { groupId: 'g', artifactId: 'x', version: '1.0', sha256: sha256('payload') };
  await p.obtain(coords, path.join(dir, 'x.jar'), { baseUrl });
  assert.deepEqual(requests, ['/repo/g/x/1.0/x-1.0.jar']);

  await assert.rejects(
    p.obtain({ ...coords, version: '2.0' }, path.join(dir, 'y.jar'), { baseUrl }),
    /HTTP 404/,
  );
});

/*
 * A whole install against a fake lock: a tar.gz "backend" with lib/ and a
 * jre/bin/java shim, plus one analyzer jar, all served offline.
 */
test(
  'install unpacks the backend, places analyzers, and writes a manifest only at the end',
  { skip: process.platform === 'win32' },
  async (t) => {
    const dir = scratch(t);
    const from = path.join(dir, 'from');
    const staging = path.join(dir, 'staging');
    fs.mkdirSync(path.join(staging, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(staging, 'jre', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(staging, 'lib', 'backend-9.9.jar'), 'jar');
    fs.writeFileSync(
      path.join(staging, 'jre', 'bin', 'java'),
      '#!/bin/sh\necho \'openjdk version "21.0.1"\' >&2\n',
      { mode: 0o755 },
    );
    fs.mkdirSync(from);
    const archive = path.join(from, 'backend-9.9-test_os.tar.gz');
    execFileSync('tar', ['-czf', archive, '-C', staging, 'lib', 'jre']);
    fs.writeFileSync(path.join(from, 'an-1.0.jar'), 'analyzer');

    const lock = {
      backend: {
        groupId: 'g',
        artifactId: 'backend',
        version: '9.9',
        mainClass: 'Main',
        distributions: {
          'test-os': {
            classifier: 'test_os',
            extension: 'tar.gz',
            bundledJre: true,
            sha256: sha256(fs.readFileSync(archive)),
          },
          'no-arch': {
            classifier: 'no-arch',
            extension: 'zip',
            bundledJre: false,
            sha256: '0'.repeat(64),
          },
        },
      },
      analyzers: [
        {
          key: 'an',
          groupId: 'g',
          artifactId: 'an',
          version: '1.0',
          sha256: sha256('analyzer'),
          languages: ['JS'],
        },
      ],
    };

    const data = path.join(dir, 'data');
    const manifest = await p.install({
      dataDir: data,
      lock,
      fromDir: from,
      distributionKey: 'test-os',
    });
    assert.equal(manifest.bundledJre, true);
    assert.equal(manifest.javaPath, path.join(data, 'sloop', '9.9-test_os', 'jre', 'bin', 'java'));
    assert.equal(p.javaMajorVersion(manifest.javaPath), 21);
    assert.deepEqual(
      p.readInstall(data, lock).analyzers.map((a) => a.key),
      ['an'],
    );

    // Re-running is idempotent and still yields a valid install.
    await p.install({ dataDir: data, lock, fromDir: from, distributionKey: 'test-os' });
    assert.ok(p.readInstall(data, lock));

    // A lock that moved on makes the old manifest read as "not installed".
    assert.equal(
      p.readInstall(data, { ...lock, backend: { ...lock.backend, version: '10.0' } }),
      null,
    );
    const bumped = { ...lock, analyzers: [{ ...lock.analyzers[0], sha256: sha256('newer') }] };
    assert.equal(p.readInstall(data, bumped), null);
  },
);

test('a failed install writes no manifest', async (t) => {
  const dir = scratch(t);
  const lock = {
    backend: {
      groupId: 'g',
      artifactId: 'backend',
      version: '9.9',
      mainClass: 'Main',
      distributions: {
        'test-os': {
          classifier: 'c',
          extension: 'tar.gz',
          bundledJre: true,
          sha256: '0'.repeat(64),
        },
      },
    },
    analyzers: [],
  };
  fs.mkdirSync(path.join(dir, 'from'));
  fs.writeFileSync(path.join(dir, 'from', 'backend-9.9-c.tar.gz'), 'not the pinned bytes');
  await assert.rejects(
    p.install({
      dataDir: path.join(dir, 'data'),
      lock,
      fromDir: path.join(dir, 'from'),
      distributionKey: 'test-os',
    }),
    p.ChecksumError,
  );
  assert.equal(fs.existsSync(path.join(dir, 'data', p.MANIFEST)), false);
});

test('check-updates reads <release>, falling back to the last <version>', () => {
  assert.equal(
    latestFrom(
      '<versioning><release>2.0</release><versions><version>1.0</version></versions></versioning>',
    ),
    '2.0',
  );
  assert.equal(
    latestFrom('<versions><version>1.0</version><version>1.1</version></versions>'),
    '1.1',
  );
  assert.equal(latestFrom('<metadata/>'), null);
});
