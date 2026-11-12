'use strict';

/*
 * Which Eclipse formatter settings a project is formatted with. A project's
 * own profile always wins: the one its config names, else a committed Eclipse
 * profile export, else its Eclipse project preferences. The plugin's default
 * profile (the standard's style) applies only to projects that opted in, so
 * a legacy project without a profile is never restyled.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_PROFILE = path.join(__dirname, '..', '..', 'engine', 'default-formatter.xml');
const PREFS = path.join('.settings', 'org.eclipse.jdt.core.prefs');
const MAX_PROFILE_BYTES = 1024 * 1024;

function isFormatterProfile(file) {
  try {
    if (fs.statSync(file).size > MAX_PROFILE_BYTES) return false;
    const text = fs.readFileSync(file, 'utf8');
    return text.includes('<profiles') && /kind="CodeFormatterProfile"/.test(text);
  } catch {
    return false;
  }
}

/*
 * Eclipse writes this file for any project-specific compiler setting, so it
 * only counts when it is tracked and actually holds formatter settings;
 * otherwise a legacy project would be restyled with Eclipse's defaults.
 */
function isFormatterPrefs(repoRoot, file) {
  if (!fs.existsSync(file)) return false;
  const tracked = spawnSync('git', ['ls-files', '--cached', '--error-unmatch', '--', PREFS], {
    cwd: repoRoot,
  });
  if (tracked.error || tracked.status !== 0) return false;
  return /^org\.eclipse\.jdt\.core\.formatter\./m.test(fs.readFileSync(file, 'utf8'));
}

// Committed (or staged) XML files, so build output and ignored files never count.
function trackedXmlFiles(repoRoot) {
  const result = spawnSync('git', ['ls-files', '--cached', '--', '*.xml'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function resolveProfile({ repoRoot, config }) {
  const configured = config?.formatter?.profile;
  if (configured) {
    const file = path.resolve(repoRoot, configured);
    if (fs.existsSync(file)) return file;
    process.stderr.write(`java plugin: formatter profile ${configured} not found; ignoring it.\n`);
  }
  for (const rel of trackedXmlFiles(repoRoot)) {
    const file = path.join(repoRoot, rel);
    if (isFormatterProfile(file)) return file;
  }
  const prefs = path.join(repoRoot, PREFS);
  if (isFormatterPrefs(repoRoot, prefs)) return prefs;
  return config ? DEFAULT_PROFILE : null;
}

module.exports = { resolveProfile, DEFAULT_PROFILE };
