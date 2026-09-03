#!/usr/bin/env node
'use strict';

/*
Stop / SubagentStop hook: lints only the markdown files this session
touched (per track-touched.js), auto-fixes what markdownlint can, and if
violations remain, blocks the stop with `decision: "continue"` so Claude
keeps fixing them. Claude is told that a violation which can only be
resolved by forcing incorrect content (e.g. inventing a language for a
fenced code block that legitimately has none) should instead be
suppressed inline with a markdownlint-disable comment — the same pattern
already used for MD040 in .claude/commands/commit.md. Capped at
MAX_ATTEMPTS: whatever still fails at the cap is auto-suppressed the same
way so the loop can't run forever.

markdownlint-cli only resolves .markdownlint.* config relative to its own
process cwd (not per-file, not walking up from cwd), so files are grouped
by their nearest config directory (see lib.js) and linted per group with
cwd set there — otherwise a config file wouldn't reliably apply.
*/

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { stateDir, groupByConfigDir } = require('./lib');

const MAX_ATTEMPTS = 3;
const NPX_PATH = path.join(path.dirname(process.execPath), 'npx');

// The state directory is shared with verify-tests.js (keyed by session id).
// Only remove the files this hook owns, then drop the directory if that
// leaves it empty — a blind recursive rmSync here would also wipe the
// other hook's still-pending state.
const OWN_STATE_FILES = ['touched-files.txt', 'attempts.json'];

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function cleanup(dir) {
  for (const name of OWN_STATE_FILES) {
    try {
      fs.rmSync(path.join(dir, name), { force: true });
    } catch {
      // best effort
    }
  }
  try {
    fs.rmdirSync(dir);
  } catch {
    // not empty (other hook's state still pending) or already gone
  }
}

function lintGroups(groups, extraArgs) {
  let combinedOutput = '';
  let anyFailed = false;
  for (const [dir, groupFiles] of groups) {
    const result = spawnSync(NPX_PATH, ['-y', 'markdownlint-cli', ...extraArgs, ...groupFiles], {
      cwd: dir,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      anyFailed = true;
      combinedOutput += (result.stdout || '') + (result.stderr || '');
    }
  }
  return { anyFailed, combinedOutput: combinedOutput.trim() };
}

/*
Structured version of the check, used only for auto-suppression: gives
back each violation's file/line/rule instead of formatted text.
markdownlint-cli writes --json output to stderr.
*/
function lintGroupsJson(groups) {
  const violations = [];
  for (const [dir, groupFiles] of groups) {
    const result = spawnSync(NPX_PATH, ['-y', 'markdownlint-cli', '--json', ...groupFiles], {
      cwd: dir,
      encoding: 'utf8',
    });
    const raw = (result.stderr || result.stdout || '').trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) violations.push(...parsed);
    } catch {
      // Unparsable output just means we can't auto-suppress these; the
      // caller falls back to leaving them for the plain-text message.
    }
  }
  return violations;
}

/*
Inserts inline markdownlint-disable comments for violations that are
being given up on, rather than leaving them unresolved forever. Line-scoped
violations get a `disable-next-line` comment directly above the offending
line (multiple rules on the same line share one comment); violations
markdownlint doesn't attach to a line get a whole-file `disable` comment
placed after any front matter. Returns what was suppressed, for logging.
*/
function insertSuppressions(violations) {
  const byFile = new Map();
  for (const violation of violations) {
    if (!byFile.has(violation.fileName)) byFile.set(violation.fileName, []);
    byFile.get(violation.fileName).push(violation);
  }

  const suppressed = [];
  for (const [file, fileViolations] of byFile) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');

    const byLine = new Map();
    const unlined = new Set();
    for (const violation of fileViolations) {
      const rule = violation.ruleNames[0];
      if (violation.lineNumber) {
        if (!byLine.has(violation.lineNumber)) {
          byLine.set(violation.lineNumber, new Set());
        }
        byLine.get(violation.lineNumber).add(rule);
      } else {
        unlined.add(rule);
      }
    }

    // Insert bottom-to-top so earlier line numbers stay valid.
    const lineNumbers = [...byLine.keys()].sort((a, b) => b - a);
    for (const lineNumber of lineNumbers) {
      const rules = [...byLine.get(lineNumber)];
      lines.splice(lineNumber - 1, 0, `<!-- markdownlint-disable-next-line ${rules.join(' ')} -->`);
      suppressed.push({ file, lineNumber, rules });
    }

    if (unlined.size > 0) {
      const rules = [...unlined];
      let insertAt = 0;
      if (lines[0] === '---') {
        const closeIndex = lines.indexOf('---', 1);
        if (closeIndex !== -1) insertAt = closeIndex + 1;
      }
      lines.splice(insertAt, 0, `<!-- markdownlint-disable ${rules.join(' ')} -->`);
      suppressed.push({ file, lineNumber: null, rules });
    }

    fs.writeFileSync(file, lines.join('\n'));
  }
  return suppressed;
}

function main() {
  let input;
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    return;
  }

  const hookEventName = input.hook_event_name || 'Stop';
  const dir = stateDir(input.session_id);
  const listFile = path.join(dir, 'touched-files.txt');

  if (!fs.existsSync(listFile)) return;

  const files = [...new Set(fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean))].filter(
    (f) => fs.existsSync(f) && /\.md$/i.test(f),
  );

  if (files.length === 0) {
    cleanup(dir);
    return;
  }

  const attemptsFile = path.join(dir, 'attempts.json');
  let attempts = 0;
  if (fs.existsSync(attemptsFile)) {
    try {
      attempts = JSON.parse(fs.readFileSync(attemptsFile, 'utf8')).count || 0;
    } catch {
      attempts = 0;
    }
  }

  const groups = groupByConfigDir(files);

  let checkOutcome;
  try {
    // Auto-fix what markdownlint can fix on its own, per config group.
    lintGroups(groups, ['--fix']);
    checkOutcome = lintGroups(groups, []);
  } catch (err) {
    process.stderr.write(`markdown plugin: lint invocation failed: ${err.message}\n`);
    return;
  }

  if (!checkOutcome.anyFailed) {
    cleanup(dir);
    return;
  }

  const violations = checkOutcome.combinedOutput;

  if (attempts >= MAX_ATTEMPTS) {
    const jsonViolations = lintGroupsJson(groups);
    if (jsonViolations.length > 0) {
      const suppressed = insertSuppressions(jsonViolations);
      process.stderr.write(
        `markdown plugin: markdownlint violations remained after ${MAX_ATTEMPTS} fix attempts; ` +
          'auto-suppressed with inline markdownlint-disable comments instead of looping forever:\n' +
          suppressed
            .map((s) => `  ${s.file}:${s.lineNumber ?? '*'} — ${s.rules.join(', ')}`)
            .join('\n') +
          '\n',
      );
    } else {
      process.stderr.write(
        `markdown plugin: markdownlint violations remain after ${MAX_ATTEMPTS} fix attempts ` +
          `and could not be parsed for auto-suppression; giving up for this session.\n${violations}\n`,
      );
    }
    cleanup(dir);
    return;
  }

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(attemptsFile, JSON.stringify({ count: attempts + 1 }));

  const output = {
    hookSpecificOutput: {
      hookEventName,
      decision: 'continue',
      stopReason: 'Markdown files touched in this session still have markdownlint violations.',
      systemMessage:
        'markdownlint found unresolved issues in markdown files edited this session ' +
        `(attempt ${attempts + 1}/${MAX_ATTEMPTS}):\n\n${violations}\n\n` +
        'Auto-fixable issues were already applied. Fix the remaining ones directly, ' +
        'respecting any .markdownlint.json/.jsonc/.yaml/.yml in the project. If fixing ' +
        'one properly would mean forcing incorrect content (e.g. inventing a language ' +
        'for a fenced code block that legitimately has none), suppress that specific ' +
        'rule inline instead of forcing a fix — `<!-- markdownlint-disable-next-line ' +
        'MDxxx -->` above the line, or `<!-- markdownlint-disable MDxxx -->` for a wider ' +
        "span (see the MD040 example in .claude/commands/commit.md). Whatever's still " +
        `unresolved after attempt ${MAX_ATTEMPTS} will be auto-suppressed this way, then finish.`,
    },
  };

  process.stdout.write(JSON.stringify(output));
}

main();
