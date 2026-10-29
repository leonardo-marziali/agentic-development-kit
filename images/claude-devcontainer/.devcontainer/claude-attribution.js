#!/usr/bin/env node
'use strict';

/*
Turns Claude Code's commit / pull request attribution (the
"Co-Authored-By: Claude ..." trailer and the "Generated with Claude Code"
footer) off or back on in ~/.claude/settings.json.

Usage:
  claude-attribution --disable   # write the empty attribution
  claude-attribution --enable    # drop it, restoring defaults
  claude-attribution --status    # report the current state
  claude-attribution --from-env  # follow $CLAUDE_ATTRIBUTION; no-op when unset
  claude-attribution --settings <file>   # override the target

The dev container image runs `--from-env` on every start, so setting
CLAUDE_ATTRIBUTION=false in a project's devcontainer.json containerEnv
turns the attribution off.
*/

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');

const ENV_VAR = 'CLAUDE_ATTRIBUTION';
const FALSE_VALUES = new Set(['false', '0', 'off', 'no', 'disabled']);
const TRUE_VALUES = new Set(['true', '1', 'on', 'yes', 'enabled']);

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
    if (['--enable', '--disable', '--status', '--from-env'].includes(arg)) {
      if (action && action !== arg.slice(2)) {
        throw new Error('Pass only one of --enable, --disable, --status, --from-env');
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

  if (!action) throw new Error('Pass one of --enable, --disable, --status, --from-env');
  return { action, settingsPath };
}

function actionFromEnv(env) {
  const raw = env[ENV_VAR];
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = raw.trim().toLowerCase();
  if (FALSE_VALUES.has(value)) return 'disable';
  if (TRUE_VALUES.has(value)) return 'enable';
  throw new Error(`${ENV_VAR}=${raw} is not a boolean (use true or false)`);
}

function run(argv, env = process.env) {
  let { action, settingsPath } = parseArgs(argv);

  if (action === 'from-env') {
    action = actionFromEnv(env);
    if (!action) return `${ENV_VAR} is not set; leaving ${settingsPath} alone`;
  }

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
