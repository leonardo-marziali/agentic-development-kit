'use strict';

/*
 * The three tools that can enforce an .editorconfig, behind one shape:
 * `run({ files, cwd, fix })` returns findings, or throws ToolFailure when the
 * tool could not run at all. A non-zero exit with parseable findings is a
 * result; a non-zero exit without any is a broken tool.
 */

const fs = require('node:fs');
const path = require('node:path');
const { resolveBin, runBin } = require('@leonardo-marziali/ad-lfl-kit');
const { parseCheckerFindings, parseEc4jFindings } = require('./lib');

// Keep in step with the Stop timeout in hooks.json: a stop can run a JVM three times.
const JVM_TIMEOUT_MS = 180 * 1000;
const CHECKER_TIMEOUT_MS = 90 * 1000;
const CHECKER_PACKAGE = 'editorconfig-checker@7.0.0';
const NARROW_INCLUDES_SCRIPT = path.join(__dirname, 'narrow-includes.gradle');

class ToolFailure extends Error {}

function outputOf(result) {
  return ((result.stdout || '') + (result.stderr || '')).trim();
}

function assertSpawned(result, tool) {
  if (result.error) throw new ToolFailure(`${tool}: ${result.error.message}`);
}

function pathDirs() {
  return (process.env.PATH || '').split(path.delimiter).filter(Boolean);
}

function runCheckerProcess(args, cwd) {
  const options = { cwd, encoding: 'utf8', timeout: CHECKER_TIMEOUT_MS };
  /*
   * An installed binary saves the wrapper's download, and the GitHub API rate
   * limit that download is subject to. Exit 2 from an old one without --fix is
   * handled by the caller like any other failed fix.
   */
  const installed = resolveBin('editorconfig-checker', { extraDirs: pathDirs() });
  return path.isAbsolute(installed)
    ? runBin(installed, args, options)
    : runBin('npx', ['-y', CHECKER_PACKAGE, ...args], options);
}

function runCheckerOn({ files, cwd, fix, extraArgs }) {
  const args = ['-format', 'gcc', '-no-color', ...extraArgs, ...(fix ? ['--fix'] : []), ...files];
  const result = runCheckerProcess(args, cwd);
  assertSpawned(result, 'editorconfig-checker');
  if (result.status === 0) return [];

  const findings = parseCheckerFindings(result.stdout, cwd);
  if (findings.length === 0 && !fix) {
    throw new ToolFailure(`editorconfig-checker: ${outputOf(result)}`);
  }
  return findings;
}

/*
 * Markdown needs indents that aren't multiples of indent_size: a numbered list
 * item's continuation lines align at 3 spaces, which is also what Prettier
 * writes. Tabs against indent_style = space still get reported.
 */
function runChecker({ files, cwd, fix = false }) {
  const isMarkdown = (file) => /\.(md|mdx|markdown)$/i.test(file);
  const batches = [
    { files: files.filter((file) => !isMarkdown(file)), extraArgs: [] },
    { files: files.filter(isMarkdown), extraArgs: ['-disable-indent-size'] },
  ];
  return batches
    .filter((batch) => batch.files.length > 0)
    .flatMap((batch) => runCheckerOn({ ...batch, cwd, fix }));
}

/*
 * A wrapper may sit above the directory declaring ec4j (a submodule's own
 * plugin block, say), but not outside the repository.
 */
function jvmBin(wrapper, tool, root) {
  const dirs = [];
  let dir = root;
  while (true) {
    dirs.push(dir);
    const parent = path.dirname(dir);
    if (fs.existsSync(path.join(dir, '.git')) || parent === dir) break;
    dir = parent;
  }
  const found = resolveBin(wrapper, { extraDirs: dirs });
  return path.isAbsolute(found) ? found : tool;
}

function runJvm(bin, args, root) {
  const result = runBin(bin, args, { cwd: root, encoding: 'utf8', timeout: JVM_TIMEOUT_MS });
  assertSpawned(result, bin);

  /*
   * failOnFormatViolation=false in the project's build reports violations on a
   * successful exit, so read the output whatever the status was.
   */
  const findings = parseEc4jFindings(outputOf(result), root);
  if (result.status !== 0 && findings.length === 0) {
    throw new ToolFailure(`${bin}: ${outputOf(result).slice(-2000)}`);
  }
  return findings;
}

function includesFor(files, root) {
  return files.map((file) => path.relative(root, file).split(path.sep).join('/')).join(',');
}

function runMaven({ files, root, fix = false }) {
  return runJvm(
    jvmBin('mvnw', 'mvn', root),
    [
      '-B',
      // Only this project: includes are relative to it, not to its modules.
      '-N',
      `-Deditorconfig.includes=${includesFor(files, root)}`,
      '-Deditorconfig.excludeSubmodules=false',
      '-Deditorconfig.failOnNoMatchingProperties=false',
      fix ? 'editorconfig:format' : 'editorconfig:check',
    ],
    root,
  );
}

function runGradle({ files, root, fix = false }) {
  return runJvm(
    jvmBin('gradlew', 'gradle', root),
    [
      '--console=plain',
      '--init-script',
      NARROW_INCLUDES_SCRIPT,
      `-Padk.editorconfig.includes=${includesFor(files, root)}`,
      '-p',
      root,
      fix ? 'editorconfigFormat' : 'editorconfigCheck',
    ],
    root,
  );
}

const JVM_RUNNERS = { maven: runMaven, gradle: runGradle };

module.exports = { ToolFailure, runChecker, JVM_RUNNERS };
