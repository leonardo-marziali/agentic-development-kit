'use strict';

/*
 * Which Eclipse formatter settings a project is formatted with. A project's
 * own profile always wins: the one its config names, else a committed Eclipse
 * profile export, else its Eclipse project preferences. The plugin's default
 * profile (the standard's style) applies only to projects that opted in, so
 * a legacy project without a profile is never restyled.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
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
function isPrefsTracked(repoRoot) {
  const tracked = spawnSync('git', ['ls-files', '--cached', '--error-unmatch', '--', PREFS], {
    cwd: repoRoot,
  });
  return !tracked.error && tracked.status === 0;
}

function isFormatterPrefs(repoRoot, file) {
  if (!fs.existsSync(file) || !isPrefsTracked(repoRoot)) return false;
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
  return discoveredProfile(repoRoot) ?? (config ? DEFAULT_PROFILE : null);
}

function scanForProfile(repoRoot, xmlFiles) {
  for (const rel of xmlFiles) {
    const file = path.join(repoRoot, rel);
    if (isFormatterProfile(file)) return file;
  }
  const prefs = path.join(repoRoot, PREFS);
  return isFormatterPrefs(repoRoot, prefs) ? prefs : null;
}

function cacheFile(repoRoot) {
  const base =
    process.env.CLAUDE_PLUGIN_DATA || path.join(os.homedir(), '.cache', 'claude-java-plugin');
  const key = crypto.createHash('sha256').update(path.resolve(repoRoot)).digest('hex');
  return path.join(base, 'profile-cache', `${key.slice(0, 16)}.json`);
}

/*
 * A committed profile or prefs file, remembered between stops: the files are
 * only read again when a tracked XML file (or the prefs) appears, disappears
 * or changes size or modification time.
 */
function discoveredProfile(repoRoot) {
  const xmlFiles = trackedXmlFiles(repoRoot);
  const stamp = crypto.createHash('sha256');
  const prefsPath = path.join(repoRoot, PREFS);
  stamp.update(`prefs tracked: ${fs.existsSync(prefsPath) && isPrefsTracked(repoRoot)}\n`);
  for (const rel of [...xmlFiles, PREFS]) {
    try {
      const stat = fs.statSync(path.join(repoRoot, rel));
      stamp.update(`${rel}\0${stat.size}\0${stat.mtimeMs}\n`);
    } catch {
      stamp.update(`${rel}\0-\n`);
    }
  }
  const key = stamp.digest('hex');
  const cache = cacheFile(repoRoot);
  try {
    const cached = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (cached.key === key) return cached.profile;
  } catch {
    // No cache yet, or an unreadable one: scan.
  }
  const profile = scanForProfile(repoRoot, xmlFiles);
  try {
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, JSON.stringify({ key, profile }));
  } catch {
    // A cache that can't be written only costs a rescan.
  }
  return profile;
}

module.exports = { resolveProfile, DEFAULT_PROFILE };
