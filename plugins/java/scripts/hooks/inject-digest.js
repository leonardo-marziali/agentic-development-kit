#!/usr/bin/env node
'use strict';

/*
SessionStart / SubagentStart hook: in a project that opted in with
.claude/java-standards.json, hands Claude a must-follow digest of the Java
standard and the paths it covers. SessionStart also fires after a
compaction, so the digest survives it; subagents get their own copy.

A project without the config gets nothing: its existing conventions win.
*/

const fs = require('node:fs');
const path = require('node:path');
const { readHookInput } = require('@leonardo-marziali/ad-lfl-kit');
const { loadConfig, findRepoRoot } = require('./config');

const DIGEST_FILE = path.join(__dirname, 'digest.md');

function bulletList(patterns) {
  return patterns.length > 0 ? patterns.map((p) => `- \`${p}\``).join('\n') : '- (none)';
}

function buildDigest(config) {
  const scope = [
    '## Scope',
    '',
    'The standard applies to files matching (gitignore syntax, from the repository root):',
    '',
    bulletList(config.include),
    '',
    'except:',
    '',
    bulletList(config.exclude),
    '',
    'Outside these paths, follow the conventions of the surrounding code instead of this standard.',
  ].join('\n');
  return `${fs.readFileSync(DIGEST_FILE, 'utf8').trim()}\n\n${scope}\n`;
}

function main() {
  const input = readHookInput();
  if (!input) return;

  const repoRoot = findRepoRoot(input.cwd || process.cwd());
  const config = repoRoot ? loadConfig(repoRoot) : null;
  if (!config) return;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: input.hook_event_name || 'SessionStart',
        additionalContext: buildDigest(config),
      },
    }),
  );
}

if (require.main === module) main();

module.exports = { buildDigest };
