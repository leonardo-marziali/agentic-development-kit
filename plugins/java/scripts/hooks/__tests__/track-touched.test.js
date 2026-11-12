'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { mkScratchDir, rmScratchDir, uniqueSessionId, track, runHook } = require('./helpers');

function setup(t) {
  const scratch = mkScratchDir();
  t.after(() => rmScratchDir(scratch));
  return { scratch, pluginData: path.join(scratch, 'plugin-data'), sessionId: uniqueSessionId() };
}

function touched({ pluginData, sessionId }) {
  const listFile = path.join(pluginData, 'java-plugin', sessionId, 'touched-files.txt');
  return fs.existsSync(listFile)
    ? fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean)
    : [];
}

// Creates `relPath` under the scratch dir and returns its absolute path.
function create({ scratch }, relPath) {
  const file = path.join(scratch, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'class A {}\n');
  return file;
}

for (const { name, file, tool } of [
  { name: 'a .java file on Write', file: 'src/main/java/A.java', tool: 'Write' },
  { name: 'a .java file on Edit', file: 'src/main/java/B.java', tool: 'Edit' },
  { name: 'a pom.xml', file: 'pom.xml', tool: 'Edit' },
  { name: 'a build.gradle', file: 'build.gradle', tool: 'Edit' },
  { name: 'a build.gradle.kts', file: 'app/build.gradle.kts', tool: 'Write' },
  {
    name: 'a .java file in a package named build',
    file: 'src/main/java/com/acme/build/C.java',
    tool: 'Write',
  },
]) {
  test(`tracks ${name}`, (t) => {
    const ctx = setup(t);
    const abs = create(ctx, file);

    const res = track(abs, ctx, tool);

    assert.equal(res.status, 0);
    assert.deepEqual(touched(ctx), [abs]);
  });
}

for (const [name, file] of [
  ['non-Java files', 'README.md'],
  ['generated sources under target/', 'target/generated-sources/gen/B.java'],
  ['Gradle output under build/', 'build/generated/sources/B.java'],
  ['the Gradle cache', '.gradle/x/B.java'],
  ['files under node_modules', 'node_modules/x/B.java'],
]) {
  test(`ignores ${name}`, (t) => {
    const ctx = setup(t);
    const abs = create(ctx, file);

    const res = track(abs, ctx);

    assert.equal(res.status, 0);
    assert.deepEqual(touched(ctx), []);
  });
}

function bash(event, { scratch, pluginData, sessionId }, extra = {}) {
  return runHook(
    'track-touched.js',
    {
      hook_event_name: event,
      tool_name: 'Bash',
      tool_input: { command: 'sed -i s/a/b/ src/C.java' },
      tool_use_id: 'toolu_bash',
      session_id: sessionId,
      cwd: scratch,
      ...extra,
    },
    { env: { CLAUDE_PLUGIN_DATA: pluginData } },
  );
}

test('tracks .java files a Bash command wrote, and nothing else it wrote', (t) => {
  const ctx = setup(t);

  bash('PreToolUse', ctx);
  const abs = create(ctx, 'src/C.java');
  create(ctx, 'notes.txt');
  create(ctx, 'target/classes/D.java');
  bash('PostToolUse', ctx);

  assert.deepEqual(touched(ctx), [abs]);
});
