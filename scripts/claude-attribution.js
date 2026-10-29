#!/usr/bin/env node
'use strict';

/*
Turns Claude Code's commit / pull request attribution (the
"Co-Authored-By: Claude ..." trailer and the "Generated with Claude Code"
footer) off or back on in ~/.claude/settings.json.

Usage:
  node scripts/claude-attribution.js --disable   # write the empty attribution
  node scripts/claude-attribution.js --enable    # drop it, restoring defaults
  node scripts/claude-attribution.js --status    # report the current state
  node scripts/claude-attribution.js --settings <file>   # override the target
*/

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

const DISABLED_ATTRIBUTION = { commit: '', pr: '', sessionUrl: false };

function readSettings(settingsPath) {
  let raw;
  try {
    raw = fs.readFileSync(settingsPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  if (raw.trim() === '') return {};

  let settings;
  try {
    settings = JSON.parse(raw);
  } catch (error) {
    throw new Error(`${settingsPath} is not valid JSON: ${error.message}`);
  }
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`${settingsPath} must contain a JSON object`);
  }
  return settings;
}

function writeSettings(settingsPath, settings) {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function isDisabled(settings) {
  const { attribution } = settings;
  return (
    attribution !== null &&
    typeof attribution === 'object' &&
    attribution.commit === '' &&
    attribution.pr === '' &&
    attribution.sessionUrl === false
  );
}

function disable(settingsPath) {
  const settings = readSettings(settingsPath);
  writeSettings(settingsPath, { ...settings, attribution: { ...DISABLED_ATTRIBUTION } });
}

function enable(settingsPath) {
  const settings = readSettings(settingsPath);
  if (!('attribution' in settings)) return;
  const { attribution: _removed, ...rest } = settings;
  writeSettings(settingsPath, rest);
}

function parseArgs(argv) {
  let action;
  let settingsPath = DEFAULT_SETTINGS_PATH;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--enable' || arg === '--disable' || arg === '--status') {
      if (action && action !== arg.slice(2)) {
        throw new Error('Pass only one of --enable, --disable, --status');
      }
      action = arg.slice(2);
    } else if (arg === '--settings') {
      i += 1;
      if (!argv[i]) throw new Error('--settings needs a file path');
      settingsPath = path.resolve(argv[i]);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!action) throw new Error('Pass one of --enable, --disable, --status');
  return { action, settingsPath };
}

function run(argv) {
  const { action, settingsPath } = parseArgs(argv);

  if (action === 'disable') {
    disable(settingsPath);
    return `Claude Code attribution disabled in ${settingsPath}`;
  }
  if (action === 'enable') {
    enable(settingsPath);
    return `Claude Code attribution enabled (defaults restored) in ${settingsPath}`;
  }
  return isDisabled(readSettings(settingsPath))
    ? 'Claude Code attribution: disabled'
    : 'Claude Code attribution: enabled';
}

function main() {
  try {
    console.log(run(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { readSettings, isDisabled, disable, enable, parseArgs, run };
