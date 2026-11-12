'use strict';

const path = require('node:path');

const STATE_NAMESPACE = 'java-plugin';
const TOUCHED_FILES = 'touched-files.txt';

const BUILD_FILE_NAMES = new Set(['pom.xml', 'build.gradle', 'build.gradle.kts']);

function isJavaFile(filePath) {
  return /\.java$/i.test(filePath);
}

function isBuildFile(filePath) {
  return BUILD_FILE_NAMES.has(path.basename(filePath));
}

// Never the session's own source, even when a tool call writes into them.
const ALWAYS_IGNORED = new Set(['node_modules', '.git', 'target', '.gradle']);

/*
 * `build` is Gradle's output directory, but also a plausible Java package
 * name (com.acme.build), so it's ignored only before any `src` segment.
 */
function isIgnoredPath(absPath) {
  const segments = path.dirname(path.resolve(absPath)).split(path.sep);
  let seenSrc = false;
  for (const segment of segments) {
    if (segment === 'src') seenSrc = true;
    if (ALWAYS_IGNORED.has(segment)) return true;
    if (segment === 'build' && !seenSrc) return true;
  }
  return false;
}

function isTrackable(absPath) {
  return (isJavaFile(absPath) || isBuildFile(absPath)) && !isIgnoredPath(absPath);
}

module.exports = {
  STATE_NAMESPACE,
  TOUCHED_FILES,
  isJavaFile,
  isBuildFile,
  isIgnoredPath,
  isTrackable,
};
