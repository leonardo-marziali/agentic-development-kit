'use strict';

/*
 * The markdown-specific half of this plugin's hooks. The generic loop
 * machinery — hook input, session state, file tracking, the capped fix loop,
 * spawning CLI shims — comes from @leonardo-marziali/ad-lfl-kit.
 */

const fs = require('node:fs');
const path = require('node:path');

/*
 * track-touched.js writes the list and check-and-loop.js reads it, so both
 * hooks must agree on where this session's state lives.
 */
const STATE_NAMESPACE = 'markdown-session-scope';
const TOUCHED_FILES = 'touched-files.txt';

function isMarkdownFile(filePath) {
  return /\.md$/i.test(filePath);
}

const CONFIG_NAMES = [
  '.markdownlint.jsonc',
  '.markdownlint.json',
  '.markdownlint.yaml',
  '.markdownlint.yml',
];

/*
markdownlint-cli only resolves config files relative to its own process
cwd — it does NOT walk up from, or check the directory of, the files it
lints. To respect the nearest .markdownlint.* to each file (including in
a monorepo), we have to do that walk ourselves and invoke the CLI once
per resolved directory, with cwd set there.
*/
function resolveConfigDir(filePath) {
  let dir = path.dirname(path.resolve(filePath));
  const root = path.parse(dir).root;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (CONFIG_NAMES.some((name) => fs.existsSync(path.join(dir, name)))) {
      return dir;
    }
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  /*
  No config found anywhere above the file: cwd doesn't matter, use the
  file's own directory.
  */
  return path.dirname(path.resolve(filePath));
}

function groupByConfigDir(files) {
  const groups = new Map();
  for (const file of files) {
    const dir = resolveConfigDir(file);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(file);
  }
  return groups;
}

/*
Extracts markdownlint-cli's --json payload from a captured stream.

The stream isn't guaranteed to be pure JSON: npx prepends its own
notices ("Need to install the following packages...") on a cold cache,
and a straight JSON.parse of the whole blob then throws — which used to
silently disable auto-suppression. So parse the whole thing when it is
clean, and otherwise fall back to the bracketed span, which is the CLI's
actual payload. Returns null when no JSON array can be recovered.
*/
function parseViolationsJson(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return null;

  const attempt = (text) => {
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  const whole = attempt(trimmed);
  if (whole) return whole;

  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  return attempt(trimmed.slice(start, end + 1));
}

/*
`auto_suppress` in plugin.json's userConfig, surfaced to hook processes
as CLAUDE_PLUGIN_OPTION_AUTO_SUPPRESS. Absent (plugin installed before
the option existed, or never configured) reads as off.
*/
function autoSuppressEnabled() {
  const raw = (process.env.CLAUDE_PLUGIN_OPTION_AUTO_SUPPRESS || '').trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
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

module.exports = {
  STATE_NAMESPACE,
  TOUCHED_FILES,
  isMarkdownFile,
  resolveConfigDir,
  groupByConfigDir,
  parseViolationsJson,
  autoSuppressEnabled,
  insertSuppressions,
};
