'use strict';

/*
 * The commit guard: a PreToolUse check that keeps Claude from committing
 * files its session touched before the Stop hook has checked them.
 *
 * A tracked file stays on the session's list until a Stop hook's runFixLoop
 * either passes it or gives up at the attempt cap, and cleans the list up.
 * So "the list is non-empty" means exactly "this session has edits that no
 * check has signed off on yet", and a commit then would put unchecked work
 * into history and — for scope.js callers without a session base — move
 * HEAD past the very lines the check is meant to look at.
 *
 * Denying the commit turns "edit and commit" into two turns: the edit ends
 * the turn, the Stop hook runs, and a commit asked for afterwards finds the
 * list empty and goes through. Commits only happen once checks have run,
 * which in practice means once the user has seen the result and asked.
 *
 * Recognising a commit is a match on the command text, so this guards
 * against accidents, not against a determined workaround (`sh -c`, a git
 * alias, a script that commits). Only Claude's tool calls are gated: the
 * user's own terminal and `!` commands never reach a PreToolUse hook.
 */

const { readTrackedFiles } = require('./state');

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

/*
 * `git`, then any global options — `-C <dir>` and `-c <key=value>` take a
 * value, possibly quoted — then the `commit` subcommand, not `commit-tree`
 * or `commit-graph`. Anchored to a command boundary so `echo legit commit`
 * and `git log --grep commit` don't match.
 */
const ARG = String.raw`(?:"[^"]*"|'[^']*'|[^\s;&|()]+)`;
const GIT_COMMIT = new RegExp(
  String.raw`(?:^|[\s;&|()\x60{])git(?:\.exe)?` +
    String.raw`(?:\s+(?:-[Cc]\s+${ARG}|--?[\w-]+(?:=${ARG})?))*` +
    String.raw`\s+commit(?![\w-])`,
);

// A git MCP server's commit tool: `mcp__git__git_commit`, `mcp__x__commit`.
const MCP_COMMIT = /^mcp__.+__(?:git_)?commit$/;

const MAX_LISTED_FILES = 10;

/*
 * Whether this tool call creates a git commit, as far as can be told from
 * its input.
 */
function isCommitCall(input) {
  const tool = input?.tool_name || '';
  if (MCP_COMMIT.test(tool)) return true;
  if (!SHELL_TOOLS.has(tool)) return false;
  const command = input.tool_input?.command;
  return typeof command === 'string' && GIT_COMMIT.test(command);
}

function denyPayload(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  };
}

function defaultReason({ label, files }) {
  const shown = files.slice(0, MAX_LISTED_FILES).map((file) => `  ${file}`);
  if (files.length > MAX_LISTED_FILES)
    shown.push(`  … and ${files.length - MAX_LISTED_FILES} more`);
  return (
    `${label}: commit blocked. ${files.length} file(s) touched in this session have not ` +
    `passed the end-of-turn checks yet:\n${shown.join('\n')}\n\n` +
    'Commits wait until those checks have run, so nothing unchecked reaches history. ' +
    'Do not try another way to commit. Finish the work and end your turn so the Stop ' +
    'hook can check these files. If the user asked for this commit, tell them it is ' +
    'waiting on the checks and that they can ask for it again once the turn has ended ' +
    'cleanly. If the checks cannot run at all, say so: the user can still commit ' +
    'from their own terminal.'
  );
}

/*
 * The PreToolUse half: for a commit call while `listFile` still holds files
 * — filtered by `matches`, when given — prints a deny decision and returns
 * `{ denied: true, files }`; otherwise prints nothing and returns
 * `{ denied: false }`. Call it before trackSessionChanges, and skip tracking
 * when it denies: a denied call never runs, so it gets no Post event to
 * consume the snapshot.
 *
 * `label` names the plugin in the message; `buildReason({ label, files })`
 * replaces the default message entirely.
 */
function guardCommit({
  input,
  listFile,
  matches,
  label = 'ad-lfl-kit',
  buildReason = defaultReason,
  write = (text) => process.stdout.write(text),
}) {
  if (!input || input.hook_event_name !== 'PreToolUse') return { denied: false };
  if (!isCommitCall(input)) return { denied: false };

  let files = readTrackedFiles(listFile);
  if (typeof matches === 'function') files = files.filter((file) => matches(file));
  if (files.length === 0) return { denied: false };

  write(JSON.stringify(denyPayload(buildReason({ label, files }))));
  return { denied: true, files };
}

module.exports = { isCommitCall, guardCommit, commitDenyPayload: denyPayload };
