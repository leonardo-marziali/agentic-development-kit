'use strict';

/*
 * Runs the JDT engine (engine/jdt) over a batch of files and parses its
 * output. The two sides speak a tab-separated line protocol, so neither needs
 * a JSON library:
 *
 *   request file, one line per file:   <abs path> TAB <ranges>
 *     <ranges> = "*" (whole file) | "-" (don't format) | "3-4,9-9" (lines)
 *   stdout:  FORMATTED TAB <path>
 *            FINDING TAB <path> TAB <line> TAB <rule id> TAB <message>
 *            ERROR TAB <path> TAB <message>
 *
 * JAVA_PLUGIN_ENGINE_CMD replaces the `java … Main` command (tests).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MAIN_CLASS = 'dev.adk.java.engine.Main';
const ENGINE_TIMEOUT_MS = 120 * 1000;

function rangesField(ranges) {
  if (ranges === '*') return '*';
  if (!Array.isArray(ranges) || ranges.length === 0) return '-';
  return ranges.map(([start, end]) => `${start}-${end}`).join(',');
}

function engineArgs({ requestFile, profile, rules, disabled, source, boot, nullness }) {
  const args = [
    '--request',
    requestFile,
    '--rules',
    rules ? 'on' : 'off',
    '--source',
    String(source),
  ];
  args.push('--boot', boot ? `${boot.major}.${boot.minor}` : 'none');
  if (profile) args.push('--profile', profile);
  if (disabled && disabled.length > 0) args.push('--disabled', disabled.join(','));
  if (nullness) args.push('--nullness', nullness);
  return args;
}

function command(manifest, env) {
  const override = env.JAVA_PLUGIN_ENGINE_CMD;
  if (override) return { bin: override, prefix: [] };
  const classpath = [manifest.classes.jdt, ...manifest.jars.jdt].join(path.delimiter);
  return { bin: manifest.javaBin, prefix: ['-cp', classpath, MAIN_CLASS] };
}

function parseOutput(stdout) {
  const result = { formatted: [], findings: [], errors: [] };
  for (const line of stdout.split(/\r?\n/)) {
    const fields = line.split('\t');
    if (fields[0] === 'FORMATTED' && fields.length >= 2) {
      result.formatted.push(fields[1]);
    } else if (fields[0] === 'FINDING' && fields.length >= 5) {
      result.findings.push({
        file: fields[1],
        line: Number(fields[2]),
        rule: fields[3],
        message: fields.slice(4).join('\t'),
      });
    } else if (fields[0] === 'ERROR' && fields.length >= 3) {
      result.errors.push({ path: fields[1], message: fields.slice(2).join('\t') });
    }
  }
  return result;
}

function runEngine({
  manifest,
  files,
  profile = null,
  rules = false,
  disabled = [],
  source = 17,
  boot = null,
  nullness = null,
  env = process.env,
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'java-plugin-engine-'));
  try {
    const requestFile = path.join(dir, 'request.tsv');
    fs.writeFileSync(
      requestFile,
      files.map((f) => `${f.path}\t${rangesField(f.ranges)}\n`).join(''),
    );
    const { bin, prefix } = command(manifest, env);
    const result = spawnSync(
      bin,
      [...prefix, ...engineArgs({ requestFile, profile, rules, disabled, source, boot, nullness })],
      {
        encoding: 'utf8',
        timeout: ENGINE_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, ...env },
      },
    );
    if (result.error || (result.status !== 0 && !result.stdout)) {
      const reason = result.error
        ? result.error.message
        : (result.stderr || '').trim().slice(-2000);
      return {
        formatted: [],
        findings: [],
        errors: [{ path: '-', message: `engine failed: ${reason}` }],
      };
    }
    return parseOutput(result.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { runEngine, parseOutput, MAIN_CLASS };
