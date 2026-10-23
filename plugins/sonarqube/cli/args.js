'use strict';

/*
 * Argument parsing for `sonarlint`. Hand-rolled rather than node:util's
 * parseArgs so every error names the command it came from and the usage text
 * stays next to the grammar it documents.
 */

const { isSeverity } = require('./severity');

const USAGE = `Usage: sonarlint <command> [options]

Commands:
  files <paths...>              Analyze files on disk
  stdin --path <p> [--lang <l>] Analyze content read from stdin as if it were <p>
  rules [--lang <l>] [--search <text>] [--key <rule>]
                                Look up rules and their descriptions
  daemon start|stop|status      Manage the per-project analysis daemon
  doctor                        Check Java, the SLOOP install, analyzers and the daemon

Options:
  --format json|text            Output format (default: text)
  --min-severity <level>        Exit 1 only for issues at/above this level
                                (BLOCKER, CRITICAL|HIGH, MAJOR|MEDIUM, MINOR|LOW, INFO;
                                default: HIGH)
  --data-dir <dir>              Where install-sloop put SLOOP (default: $SONARLINT_HOME,
                                $CLAUDE_PLUGIN_DATA, then a per-user cache dir)
  --no-start                    Fail with exit 2 instead of starting a daemon
  --timeout <seconds>           Give up on one analysis after this long (default: 120)
  --verbose                     Include SLOOP's own log lines
  -h, --help                    Show this help

Exit codes: 0 clean or below threshold, 1 issues at/above threshold, 2 tool error.`;

const COMMANDS = new Set(['files', 'stdin', 'rules', 'daemon', 'doctor', 'help']);
const DAEMON_ACTIONS = new Set(['start', 'stop', 'status']);
const VALUE_OPTIONS = new Set([
  '--format',
  '--min-severity',
  '--data-dir',
  '--timeout',
  '--path',
  '--lang',
  '--search',
  '--key',
  '--root',
]);
const FLAG_OPTIONS = new Set(['--no-start', '--verbose', '--warm', '--help', '-h']);

class UsageError extends Error {}

function parseArgs(argv) {
  const options = {
    format: 'text',
    minSeverity: 'HIGH',
    dataDir: null,
    noStart: false,
    verbose: false,
    warm: false,
    timeoutMs: 120_000,
    path: null,
    lang: null,
    search: null,
    key: null,
    root: null,
  };
  const positional = [];
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (FLAG_OPTIONS.has(arg)) {
      if (arg === '--no-start') options.noStart = true;
      else if (arg === '--verbose') options.verbose = true;
      else if (arg === '--warm') options.warm = true;
      else help = true;
      continue;
    }
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = eq > 0 ? arg.slice(0, eq) : arg;
    if (VALUE_OPTIONS.has(name)) {
      const value = eq > 0 ? arg.slice(eq + 1) : argv[++i];
      if (value === undefined || value === '') throw new UsageError(`${name} needs a value`);
      assign(options, name, value);
      continue;
    }
    if (arg.startsWith('-') && arg !== '-') throw new UsageError(`unknown option ${arg}`);
    positional.push(arg);
  }

  const command = help ? 'help' : positional.shift();
  if (!command) throw new UsageError('no command given');
  if (!COMMANDS.has(command)) throw new UsageError(`unknown command "${command}"`);

  const parsed = { command, options, paths: [], action: null };
  if (command === 'help') return parsed;
  if (command === 'files') {
    if (positional.length === 0) throw new UsageError('files needs at least one path');
    parsed.paths = positional;
  } else if (command === 'stdin') {
    if (!options.path) throw new UsageError('stdin needs --path <virtual-path>');
    rejectExtra(command, positional);
  } else if (command === 'daemon') {
    const action = positional.shift();
    if (!DAEMON_ACTIONS.has(action)) throw new UsageError('daemon needs start, stop or status');
    parsed.action = action;
    rejectExtra(command, positional);
  } else {
    rejectExtra(command, positional);
  }
  return parsed;
}

function assign(options, name, value) {
  switch (name) {
    case '--format':
      if (value !== 'json' && value !== 'text')
        throw new UsageError('--format must be json or text');
      options.format = value;
      return;
    case '--min-severity':
      if (!isSeverity(value)) throw new UsageError(`--min-severity: unknown level "${value}"`);
      options.minSeverity = value.toUpperCase();
      return;
    case '--timeout': {
      const seconds = Number(value);
      if (!Number.isFinite(seconds) || seconds <= 0)
        throw new UsageError('--timeout must be a positive number of seconds');
      options.timeoutMs = Math.round(seconds * 1000);
      return;
    }
    case '--data-dir':
      options.dataDir = value;
      return;
    case '--lang':
      options.lang = value.toUpperCase();
      return;
    default:
      options[name.slice(2)] = value;
  }
}

function rejectExtra(command, positional) {
  if (positional.length > 0)
    throw new UsageError(`${command}: unexpected argument "${positional[0]}"`);
}

module.exports = { parseArgs, UsageError, USAGE };
