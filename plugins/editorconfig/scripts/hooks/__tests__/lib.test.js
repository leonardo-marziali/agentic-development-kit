'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('./helpers');
const {
  isEnforceable,
  hasEditorconfig,
  parseCheckerFindings,
  parseEc4jFindings,
  findingLine,
  detectBackend,
  groupByBackend,
} = require('../lib');

const GRADLE_BUILD = "plugins { id 'org.ec4j.editorconfig' version '0.1.0' }\n";
const POM = '<project><artifactId>editorconfig-maven-plugin</artifactId></project>\n';

function write(file, content = '') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

test('isEnforceable skips node_modules and .git paths only', () => {
  assert.equal(isEnforceable('/p/src/a.js'), true);
  assert.equal(isEnforceable('/p/node_modules/x/a.js'), false);
  assert.equal(isEnforceable('/p/.git/config'), false);
  assert.equal(isEnforceable('/p/.github/ci.yml'), true);
});

test('hasEditorconfig finds a config in an ancestor directory', (t) => {
  const dir = scratchDir(t);
  write(path.join(dir, '.editorconfig'));
  assert.equal(hasEditorconfig(write(path.join(dir, 'a/b/c.txt'))), true);
});

test('hasEditorconfig is false without a config above the file', (t) => {
  const dir = scratchDir(t);
  assert.equal(hasEditorconfig(write(path.join(dir, 'c.txt'))), false);
});

test('parseCheckerFindings resolves relative paths and keeps line 0', () => {
  const output = [
    'sp ace.md:1:0: error: trailing whitespace',
    'crlf.txt:0:0: error: wrong line endings or no final newline',
    '',
    '2 errors found',
  ].join('\n');
  assert.deepEqual(parseCheckerFindings(output, '/repo'), [
    { file: '/repo/sp ace.md', line: 1, message: 'trailing whitespace' },
    { file: '/repo/crlf.txt', line: 0, message: 'wrong line endings or no final newline' },
  ]);
});

test('parseEc4jFindings reads Maven and Gradle violation lines', () => {
  const output = [
    '[INFO] Checked 2 files',
    '[ERROR] src/a.txt@3,5: Delete 2 characters - violates trim_trailing_whitespace = true, reported by org.ec4j.linters.TextLinter',
    'src/b c.txt@1,1: Insert newline - violates insert_final_newline = true, reported by TextLinter',
    '[ERROR] Failed to execute goal org.ec4j.maven:editorconfig-maven-plugin:0.1.3:check',
  ].join('\n');
  const findings = parseEc4jFindings(output, '/repo');
  assert.deepEqual(
    findings.map(({ file, line }) => [file, line]),
    [
      ['/repo/src/a.txt', 3],
      ['/repo/src/b c.txt', 1],
    ],
  );
  assert.match(findings[0].message, /^Delete 2 characters - violates/);
});

test('findingLine maps a file-level finding to the last line', (t) => {
  const dir = scratchDir(t);
  const file = write(path.join(dir, 'a.txt'), 'one\ntwo\nthree');
  assert.equal(findingLine({ file, line: 2 }), 2);
  assert.equal(findingLine({ file, line: 0 }), 3);
  const terminated = write(path.join(dir, 'b.txt'), 'one\ntwo\n');
  assert.equal(findingLine({ file: terminated, line: 0 }), 2);
});

test('detectBackend defaults to the checker', (t) => {
  const dir = scratchDir(t);
  fs.mkdirSync(path.join(dir, '.git'));
  write(path.join(dir, 'build.gradle'), "plugins { id 'java' }\n");
  write(path.join(dir, 'pom.xml'), '<project/>\n');
  assert.deepEqual(detectBackend(write(path.join(dir, 'a.txt'))), { kind: 'checker', root: null });
});

test('detectBackend finds Maven in an ancestor pom', (t) => {
  const dir = scratchDir(t);
  write(path.join(dir, 'pom.xml'), POM);
  write(path.join(dir, 'mod/pom.xml'), '<project/>\n');
  assert.deepEqual(detectBackend(write(path.join(dir, 'mod/src/a.txt'))), {
    kind: 'maven',
    root: dir,
  });
});

test('detectBackend finds Gradle in build and settings scripts', (t) => {
  for (const name of ['build.gradle', 'build.gradle.kts', 'settings.gradle.kts']) {
    const dir = scratchDir(t);
    write(path.join(dir, name), GRADLE_BUILD);
    assert.deepEqual(detectBackend(write(path.join(dir, 'a.txt'))), { kind: 'gradle', root: dir });
  }
});

test('detectBackend does not look past the repository root', (t) => {
  const dir = scratchDir(t);
  write(path.join(dir, 'pom.xml'), POM);
  fs.mkdirSync(path.join(dir, 'repo/.git'), { recursive: true });
  assert.equal(detectBackend(write(path.join(dir, 'repo/a.txt'))).kind, 'checker');
});

test('groupByBackend groups per root with paths the JVM tools can express', (t) => {
  const dir = scratchDir(t);
  write(path.join(dir, 'pom.xml'), POM);
  const plain = write(path.join(dir, 'a.txt'));
  const comma = write(path.join(dir, 'a,b.txt'));
  const glob = write(path.join(dir, 'a*b.txt'));
  const groups = groupByBackend([plain, comma, glob]);
  assert.deepEqual(
    groups.map(({ kind, root, files }) => ({ kind, root, files })),
    [
      { kind: 'maven', root: dir, files: [plain] },
      { kind: 'checker', root: null, files: [comma, glob] },
    ],
  );
});
