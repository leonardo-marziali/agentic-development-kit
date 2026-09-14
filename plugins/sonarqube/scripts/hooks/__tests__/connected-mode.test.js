'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  resolveBindingDir,
  readBinding,
  groupByBinding,
  describeGroup,
} = require('../connected-mode');
const { mkScratchDir, rmScratchDir } = require('./helpers');

function writeBinding(dir, contents) {
  fs.mkdirSync(path.join(dir, '.sonarlint'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.sonarlint', 'connectedMode.json'),
    typeof contents === 'string' ? contents : JSON.stringify(contents),
  );
}

function writeFile(dir, relative, contents = 'x') {
  const full = path.join(dir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

test('resolveBindingDir walks up to the nearest binding', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  writeBinding(scratch, { projectKey: 'root-key' });
  const file = writeFile(scratch, 'src/deep/nested/app.js');

  assert.equal(resolveBindingDir(file), scratch);
});

test('resolveBindingDir prefers the closest binding in a monorepo', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  writeBinding(scratch, { projectKey: 'root-key' });
  const inner = path.join(scratch, 'packages', 'api');
  fs.mkdirSync(inner, { recursive: true });
  writeBinding(inner, { projectKey: 'api-key' });
  const file = writeFile(scratch, 'packages/api/src/app.js');

  assert.equal(resolveBindingDir(file), inner);
});

test('resolveBindingDir returns null when there is no binding anywhere above', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const file = writeFile(scratch, 'src/app.js');

  assert.equal(resolveBindingDir(file), null);
});

test('readBinding parses projectKey and both server flavours', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  writeBinding(scratch, {
    projectKey: 'my-project',
    sonarQubeUri: 'https://sonar.example.com',
  });

  assert.deepEqual(readBinding(scratch), {
    projectKey: 'my-project',
    sonarQubeUri: 'https://sonar.example.com',
    sonarCloudOrganization: null,
  });

  writeBinding(scratch, { projectKey: 'cloud-project', sonarCloudOrganization: 'my-org' });
  assert.deepEqual(readBinding(scratch), {
    projectKey: 'cloud-project',
    sonarQubeUri: null,
    sonarCloudOrganization: 'my-org',
  });
});

test('readBinding treats malformed JSON as no binding rather than throwing', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  writeBinding(scratch, '{ not json');

  assert.equal(readBinding(scratch), null);
});

test('groupByBinding groups each file under its nearest binding', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const api = path.join(scratch, 'packages', 'api');
  const web = path.join(scratch, 'packages', 'web');
  fs.mkdirSync(api, { recursive: true });
  fs.mkdirSync(web, { recursive: true });
  writeBinding(api, { projectKey: 'api-key' });
  writeBinding(web, { projectKey: 'web-key' });

  const apiFile = writeFile(scratch, 'packages/api/src/a.js');
  const apiOther = writeFile(scratch, 'packages/api/src/b.js');
  const webFile = writeFile(scratch, 'packages/web/src/c.js');

  const groups = groupByBinding([apiFile, webFile, apiOther], { fallbackDir: scratch });

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((g) => ({ dir: g.dir, key: g.binding.projectKey, files: g.files })),
    [
      { dir: api, key: 'api-key', files: [apiFile, apiOther] },
      { dir: web, key: 'web-key', files: [webFile] },
    ],
  );
});

test('groupByBinding collapses unbound files into one group rooted at the fallback', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const a = writeFile(scratch, 'src/a.js');
  const b = writeFile(scratch, 'other/b.js');

  const groups = groupByBinding([a, b], { fallbackDir: scratch });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].dir, scratch);
  assert.equal(groups[0].binding, null);
  assert.deepEqual(groups[0].files, [a, b]);
});

test('groupByBinding keeps bound and unbound files apart', (t) => {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  const bound = path.join(scratch, 'bound');
  fs.mkdirSync(bound, { recursive: true });
  writeBinding(bound, { projectKey: 'bound-key' });

  const boundFile = writeFile(scratch, 'bound/a.js');
  const looseFile = writeFile(scratch, 'loose/b.js');

  const groups = groupByBinding([boundFile, looseFile], { fallbackDir: scratch });

  assert.equal(groups.length, 2);
  assert.equal(groups[0].binding.projectKey, 'bound-key');
  assert.equal(groups[1].binding, null);
});

test('describeGroup names the project and server, or falls back to the directory', () => {
  assert.equal(
    describeGroup({
      dir: '/repo',
      binding: { projectKey: 'k', sonarQubeUri: 'https://sonar.example.com' },
    }),
    'k (https://sonar.example.com) in /repo',
  );
  assert.equal(
    describeGroup({ dir: '/repo', binding: { projectKey: 'k', sonarCloudOrganization: 'org' } }),
    'k (SonarQube Cloud org org) in /repo',
  );
  assert.equal(describeGroup({ dir: '/repo', binding: null }), '/repo');
});
