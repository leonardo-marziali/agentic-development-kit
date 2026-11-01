'use strict';

/*
 * The EditorConfig-specific half of this plugin's hooks: which files can be
 * enforced, which tool enforces them, and how to read what that tool reports.
 * The generic loop machinery — hook input, session state, file tracking, the
 * capped fix loop, line scoping — comes from @leonardo-marziali/ad-lfl-kit.
 */

const fs = require('node:fs');
const path = require('node:path');

/*
 * track-touched.js writes the list and check-and-loop.js reads it, so both
 * hooks must agree on where this session's state lives.
 */
const STATE_NAMESPACE = 'editorconfig-session-scope';
const TOUCHED_FILES = 'touched-files.txt';

const IGNORED_DIR_SEGMENTS = [`${path.sep}node_modules${path.sep}`, `${path.sep}.git${path.sep}`];

const MAVEN_MARKER = 'editorconfig-maven-plugin';
const GRADLE_MARKER = 'org.ec4j.editorconfig';
const BUILD_FILES = [
  { kind: 'maven', name: 'pom.xml', marker: MAVEN_MARKER },
  { kind: 'gradle', name: 'build.gradle', marker: GRADLE_MARKER },
  { kind: 'gradle', name: 'build.gradle.kts', marker: GRADLE_MARKER },
  { kind: 'gradle', name: 'settings.gradle', marker: GRADLE_MARKER },
  { kind: 'gradle', name: 'settings.gradle.kts', marker: GRADLE_MARKER },
];

function isEnforceable(filePath) {
  return !IGNORED_DIR_SEGMENTS.some((segment) => filePath.includes(segment));
}

function ancestorDirs(filePath) {
  const dirs = [];
  let dir = path.dirname(path.resolve(filePath));
  while (true) {
    dirs.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) return dirs;
    dir = parent;
  }
}

function hasEditorconfig(filePath) {
  return ancestorDirs(filePath).some((dir) => fs.existsSync(path.join(dir, '.editorconfig')));
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

function declaredBackend(dir) {
  const declared = BUILD_FILES.find(({ name, marker }) =>
    readIfExists(path.join(dir, name)).includes(marker),
  );
  return declared ? { kind: declared.kind, root: dir } : null;
}

/*
 * A submodule's build file usually doesn't repeat what its parent declares, so
 * keep walking past build files that don't mention ec4j — but not out of the
 * repository, where an unrelated build could be sitting above a checkout.
 */
function detectBackend(filePath) {
  for (const dir of ancestorDirs(filePath)) {
    const backend = declaredBackend(dir);
    if (backend) return backend;
    if (fs.existsSync(path.join(dir, '.git'))) break;
  }
  return { kind: 'checker', root: null };
}

/*
 * The JVM tools take includes as a comma-joined list of Ant patterns, which
 * has no escape for these characters. Such a path can't be narrowed to, and a
 * tool that can't be narrowed must not format, so the checker takes the file.
 */
function canNarrowTo(relPath) {
  return !/[,*?]/.test(relPath);
}

function groupByBackend(files) {
  const groups = new Map();
  for (const file of files) {
    let { kind, root } = detectBackend(file);
    if (root && !canNarrowTo(path.relative(root, file))) {
      kind = 'checker';
      root = null;
    }
    const key = `${kind}:${root}`;
    if (!groups.has(key)) groups.set(key, { kind, root, files: [] });
    groups.get(key).files.push(file);
  }
  return [...groups.values()];
}

// `<file>:<line>:<column>: <type>: <message>`, relative to the checker's cwd.
function parseCheckerFindings(output, cwd) {
  const findings = [];
  for (const raw of (output || '').split('\n')) {
    const match = /^(.+):(\d+):\d+: \w+: (.+)$/.exec(raw.trim());
    if (match) {
      findings.push({
        file: path.resolve(cwd, match[1]),
        line: Number(match[2]),
        message: match[3],
      });
    }
  }
  return findings;
}

/*
 * ec4j's Violation.toString: `<resource>@<line>,<column>: <fix> - violates
 * <property>, reported by <linter>`, relative to the project directory. Maven
 * prefixes a log level; Gradle may not.
 */
function parseEc4jFindings(output, baseDir) {
  const findings = [];
  for (const raw of (output || '').split('\n')) {
    const match = /^(?:\[\w+\]\s+)?(\S.*?)@(\d+),\d+: (.+ - violates .+)$/.exec(raw.trim());
    if (match) {
      findings.push({
        file: path.resolve(baseDir, match[1]),
        line: Number(match[2]),
        message: match[3],
      });
    }
  }
  return findings;
}

/*
 * The checker reports whole-file problems (a missing final newline, wrong line
 * endings) on line 0, which no diff range contains. Attribute them to the last
 * line: changing it is what a final-newline finding is about, and a mid-file
 * edit to an old CRLF file stays out of scope rather than rewriting the file.
 */
function findingLine({ file, line }) {
  if (line > 0) return line;
  const content = readIfExists(file);
  const lines = content.split('\n').length;
  return content.endsWith('\n') ? lines - 1 : lines;
}

module.exports = {
  STATE_NAMESPACE,
  TOUCHED_FILES,
  isEnforceable,
  hasEditorconfig,
  detectBackend,
  groupByBackend,
  parseCheckerFindings,
  parseEc4jFindings,
  findingLine,
};
