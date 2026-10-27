# @leonardo-marziali/ad-lfl-kit

[![npm version](https://img.shields.io/npm/v/%40leonardo-marziali%2Fad-lfl-kit.svg)](https://www.npmjs.com/package/@leonardo-marziali/ad-lfl-kit)
[![ad-lfl-kit coverage](https://codecov.io/gh/leonardo-marziali/agentic-development-kit/branch/main/graph/badge.svg?flag=ad-lfl-kit)](https://codecov.io/gh/leonardo-marziali/agentic-development-kit)

**A**gentic **d**evelopment **l**int-**f**ix-**l**oop kit: the "track what
this session touched, then check it before the session ends" pattern used by
[Claude Code](https://claude.com/claude-code) plugin hooks, as a small
zero-dependency package instead of copy-pasted hook source.

It backs the session-scoped fix loops in this repository's
[`markdown`](https://github.com/leonardo-marziali/agentic-development-kit/tree/main/plugins/markdown)
and `sonarqube` plugins, and is published standalone so any Claude Code
plugin can build the same loop without re-implementing it.

## The pattern

1. A tracking hook records every file the current session touches that
   matches some predicate — only `.md` files, say — into a session-scoped
   list. Edit-family tools name their file; for `Bash`, `PowerShell` and MCP
   tools, which don't, the hook also runs on `PreToolUse` to snapshot the
   workspace and tracks whatever changed by the time the call ends — or, for
   a command run in the background, keeps tracking its writes on later
   events. Tool calls made inside a subagent are tracked the same way, and additionally
   into that subagent's own list.
2. A `Stop`/`SubagentStop` hook reads that list — a `SubagentStop` reads only
   its subagent's — runs a check (optionally preceded by an auto-fix pass),
   and:
   - if it passes, cleans up the session state and lets the session end;
   - if it fails, blocks the stop with `decision: "block"` so Claude sees
     the failures and keeps working, up to a capped number of attempts;
   - at the cap, gives up — reporting what's left, optionally applying a
     caller-supplied fallback — rather than blocking forever.

## Install

```bash
npm install @leonardo-marziali/ad-lfl-kit
```

> **If you're shipping this inside a Claude Code plugin**, see
> [the parent repo's README](https://github.com/leonardo-marziali/agentic-development-kit#shared-packages-and-plugin-dependencies)
> for why the plugin needs its own committed `package-lock.json` for this to
> actually install where Claude Code runs the hook.

## Quick start

Two hook scripts, wired up in the plugin's `hooks/hooks.json` the same way
as [`plugins/markdown/hooks/hooks.json`](https://github.com/leonardo-marziali/agentic-development-kit/blob/main/plugins/markdown/hooks/hooks.json),
all pointed at `${CLAUDE_PLUGIN_ROOT}`:

- `PreToolUse` and `PostToolUseFailure`, matching `Bash|PowerShell|mcp__.*`
  → `track-touched.js`
- `PostToolUse`, matching
  `Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell|mcp__.*` →
  `track-touched.js`
- `Stop` and `SubagentStop` → `check-and-loop.js`

`PostToolUseFailure` matters: a command that edits files and then exits
non-zero (`./fix.py && pytest`) reports through it, not `PostToolUse`.
Subagents need nothing extra — Claude Code fires plugin hooks for their tool
calls too, with the parent's `session_id` and their own `agent_id`.

**`scripts/hooks/track-touched.js`**

```js
#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { readHookInput, stateDir, trackSessionChanges } = require('@leonardo-marziali/ad-lfl-kit');

const input = readHookInput();
if (input) {
  const dir = stateDir({
    sessionId: input.session_id,
    namespace: 'my-plugin-session-scope',
  });
  trackSessionChanges({
    input,
    listFile: path.join(dir, 'touched-files.txt'),
    matches: (absPath) => /\.md$/i.test(absPath),
  });
}
```

**`scripts/hooks/check-and-loop.js`**

```js
#!/usr/bin/env node
'use strict';

const path = require('node:path');
const {
  readHookInput,
  stateDir,
  loopStateDir,
  readTrackedFiles,
  trackSessionChanges,
  runFixLoop,
  runBin,
} = require('@leonardo-marziali/ad-lfl-kit');

const input = readHookInput();
const sessionDir = stateDir({
  sessionId: input?.session_id,
  namespace: 'my-plugin-session-scope',
});
// Collect what background commands wrote since the last tool call.
trackSessionChanges({
  input,
  listFile: path.join(sessionDir, 'touched-files.txt'),
  matches: (absPath) => absPath.endsWith('.md'),
});
// A SubagentStop gets its subagent's own directory; a Stop the session's.
const dir = loopStateDir({ dir: sessionDir, input });
const stateFiles = ['touched-files.txt', 'attempts.json'];
const files = readTrackedFiles(path.join(dir, 'touched-files.txt'));

runFixLoop({
  input,
  dir,
  stateFiles,
  files,
  fix: (files) => runBin('npx', ['-y', 'markdownlint-cli', '--fix', ...files]),
  check: (files) => {
    const result = runBin('npx', ['-y', 'markdownlint-cli', ...files], {
      encoding: 'utf8',
    });
    const report = ((result.stdout || '') + (result.stderr || '')).trim();
    return { failed: result.status !== 0, report };
  },
  onCap: ({ outcome }) => {
    process.stderr.write(`still failing after the attempt cap:\n${outcome.report}\n`);
  },
  buildMessage: ({ attempt, maxAttempts, outcome }) => ({
    stopReason: 'Files touched this session still have lint violations.',
    systemMessage: `Lint found issues (attempt ${attempt}/${maxAttempts}):\n\n${outcome.report}`,
  }),
});
```

That's a complete loop: nothing tracked → no-op; clean → allow the stop;
failing → block with a message Claude can act on, up to 3 attempts by
default; still failing at the cap → `onCap` runs once, then the stop is
allowed anyway.

## Scoping to changes against HEAD

Tracking a file is not the same as being answerable for all of it. By
default `runFixLoop` checks every touched file whole, which means a one-line
edit to a 400-line README makes every pre-existing violation in it the
session's problem. `scope.js` narrows that to the lines the working tree
actually changed:

```js
const { scopesFor, partitionByScope, fixableFiles } = require('@leonardo-marziali/ad-lfl-kit');

const scopes = scopesFor(files); // → Map<absPath, scope>, vs HEAD, ±2 lines
const { inScope, outOfScope, outOfScopeFiles } = partitionByScope(violations, {
  scopes,
});
```

The gate this produces is **"uncommitted work must not introduce lint
errors"**, not "this session must not". `HEAD` is the last known-clean
state, so anything dirty is fair game regardless of what dirtied it, and
anything committed is somebody else's problem — worth reporting once and
leaving to whatever escape hatch the plugin offers.

Scoping against a ref rather than a session-start snapshot is deliberate:
the verdict is reproducible from a shell (`git diff HEAD`), it survives
context compaction and session restarts, and it sees every write —
including the ones no `PostToolUse` hook ever hears about, like a `sed -i`,
a formatter run from another hook, or the user's own editor.

**Ordering.** Because `fixableFiles` needs to know what's out of scope, an
auto-fixing consumer runs check → fix → re-check rather than fix → check:
lint once to get the findings, partition them, fix only the files with
nothing out of scope, then lint again for the result `runFixLoop` blocks on.

**Everything fails open.** No repo, no git, an untracked or ignored path, a
ref that doesn't resolve, a diff that won't parse — each resolves to
`all: true`, the whole-file behaviour callers had before this module
existed. A scope that couldn't be computed must never be the reason a
linter goes quiet. The corollary is that unversioned trees get no narrowing
at all.

**What it won't catch.** Whole-document rules report the _other_ end of a
relationship an edit changed — delete the last use of a link reference and
markdownlint's MD053 fires on the definition hundreds of lines away, which
is out of scope. This is inherent to line-scoped review (GitHub PR
annotations, reviewdog and `lint-staged` line filters all share it); the
context margin covers the near misses, and a consumer should say what it
excluded rather than drop it silently.

## API

### Hook I/O (`hook-input.js`)

- **`readStdin()`** — reads file descriptor 0, returning `''` if nothing's
  attached (a hook invoked without stdin, some test harnesses) instead of
  throwing.
- **`readHookInput()`** — parses the hook payload Claude Code sends on
  stdin. Returns `null` for empty or malformed input, never throws.

### Session state (`state.js`)

- **`stateDir({ sessionId, namespace })`** — a directory scoped to one
  session and one namespace, under `${CLAUDE_PLUGIN_DATA}` when set (so it
  survives plugin updates) or the OS temp dir otherwise.
- **`agentStateDir(dir, agentId)`** — one subagent's share of a session
  directory, `<dir>/agents/<agentId>`. The tracking functions append a
  subagent's files here as well as to the session's list.
- **`loopStateDir({ dir, input })`** — the directory a `Stop`/`SubagentStop`
  hook should run its loop in: `agentStateDir(dir, input.agent_id)` for a
  `SubagentStop`, `dir` for anything else. A subagent is then held only to
  the files it wrote, with its own attempt count, while the main `Stop`
  still checks everything, subagents' files included.
- **`readTrackedFiles(listFile)`** — the de-duplicated contents of a tracked
  file list, filtered to files that still exist on disk.
- **`appendTrackedFile(listFile, absPath)`** — appends a path, skipping it
  if already present.
- **`readAttempts(attemptsFile)`** / **`writeAttempts(attemptsFile, count)`**
  — the attempt counter `runFixLoop` uses internally; exposed for callers
  that need to inspect or reset it directly.
- **`cleanup(dir, ownStateFiles)`** — removes only the named files, then
  removes `dir` if that leaves it empty. Deliberately not a recursive
  delete: a session dir can hold another hook's still-pending state, and a
  blind `rm -rf` would destroy it.

### Tracking (`track.js`)

- **`trackSessionChanges({ input, listFile, matches })`** — the tracking
  half; wire it to `PreToolUse`, `PostToolUse` and `PostToolUseFailure`,
  and call it from the `Stop`/`SubagentStop` hook too, before reading
  `listFile`, so background writes made after the last tool call are
  collected. Tracks every file `toolChangedFiles` reports that
  `matches(absPath)` accepts (omit `matches` to track everything), in
  `listFile` and — for a subagent's call — in that subagent's list. A
  background command's later writes reach its subagent's list only while
  that subagent is the one calling; the session's list always gets them.
  Snapshots are kept beside `listFile`. Returns the tracked paths.
- **`toolChangedFiles({ input, stateDir })`** — the files one tool call
  wrote, for hooks that act on them without tracking (a formatter). For
  `Edit`, `Write`, `MultiEdit` and `NotebookEdit` that's the file the input
  names, if it exists. For `Bash`, `PowerShell` and `mcp__*` tools,
  `PreToolUse` writes a snapshot to `<stateDir>/pending/<tool_use_id>.json`
  and the `Post*` event returns what changed since and consumes it, so only
  one script per state dir should call this. Read-only tools return `[]`
  without scanning anything.

  A backgrounded command — `run_in_background: true`, or one the user sent
  to the background, which Claude Code reports with a `backgroundTaskId` —
  gets its `Post*` event as soon as it's backgrounded, while it keeps
  writing. Its snapshot then moves to `<stateDir>/background/` instead of
  being consumed, and every later `Post*`, `Stop` and `SubagentStop` event
  also returns what it wrote since the previous such sweep. Hooks aren't
  told when a background command exits, so its window closes
  `BACKGROUND_WINDOW_MS` (2 hours) after it started, with one last sweep.
  Within the window, anything written in the scanned repos counts —
  including edits you make in an editor meanwhile.

- **`trackTouchedFile({ input, listFile, matches })`** — the Edit-family
  subset of `trackSessionChanges`: no-ops unless `input.tool_name` is
  `Edit`, `Write`, `MultiEdit` or `NotebookEdit` and the file it names still
  exists. Returns the tracked absolute path, or `null`.

### Change detection (`changes.js`)

How `toolChangedFiles` answers for tools that don't name their files.

- **`snapshotWorkspace(cwd)`** — `{ startedAt, cwd, root, head }`: the time,
  the cwd, and the git root and `HEAD` it sits in (both `null` outside a
  repo).
- **`advanceSnapshot(snapshot)`** — the same snapshot moved up to now (new
  time and `HEAD`), for watching a window that stays open.
- **`filesChangedSince(snapshot, { cwd })`** — absolute paths written since
  the snapshot. In a repo: the dirty and untracked files from `git status`,
  plus the files of commits made during the call (so `edit && git commit`
  isn't missed), keeping only those whose mtime falls after the snapshot.
  Already-dirty files the call didn't touch are older than that, and a
  `checkout` or `pull` leaves the tree clean and brings commits dated
  before the call, so neither drags in unrelated files. Outside a repo: a
  bounded walk of the cwd. Gitignored files and dependency directories
  (`node_modules`, `.venv`, `__pycache__`…) are never reported. Unlike
  `scope.js` this fails closed — an error means "nothing changed" — since
  it decides which files a session becomes answerable for.
- **`MTIME_SLACK_MS`** / **`PRUNED_DIR_NAMES`** — the mtime tolerance for
  coarse filesystems, and the directories skipped.

What it can't see: writes outside both the snapshot's and the current
cwd's repository, and a background command's writes more than
`BACKGROUND_WINDOW_MS` after it started.

### Execution (`exec.js`)

- **`resolveBin(name, { extraDirs })`** — finds a CLI binary across
  platforms. Checks beside `process.execPath` first (where `npx`/`npm`
  live), then each of `extraDirs` (for binaries installed elsewhere — a
  Homebrew or `mise` shim, say), trying the Windows-appropriate suffix
  (`.cmd`/`.exe`) before falling back to the bare name for PATH lookup.
- **`quoteForCmd(arg)`** — quotes one argument for `cmd.exe`, which
  `spawnSync` doesn't do for you when `shell: true`.
- **`runBin(name, args, options)`** — resolves and runs a binary, routing
  through a shell only on Windows (where the shim is a `.cmd` batch file
  Node won't exec directly), with arguments quoted by hand there so no
  shell ever parses a file path on any other platform. `options` also
  accepts `extraDirs`, forwarded to `resolveBin`.

### Scoping (`scope.js`)

Narrows a check from _this file_ to _the lines in this file that differ from
a git ref_, so a one-line edit to a long, already-messy document doesn't hand
Claude every pre-existing violation in it. See
[Scoping to changes against HEAD](#scoping-to-changes-against-head).

- **`scopesFor(files, { ref, context })`** — the entry point: a `Map` of
  absolute path → scope, with the context margin already applied. `ref`
  defaults to `HEAD`, `context` to `DEFAULT_CONTEXT_LINES` (2). A scope is
  `{ file, all, ranges, includes(line) }`, where `all` means the whole file
  is in scope and `ranges` are inclusive, 1-based `[start, end]` pairs in
  current-file coordinates. `includes()` called without a line number
  returns `all`.
- **`changedRangesByFile(files, { ref })`** — the same answer before the
  margin is applied, as `{ all, ranges }`. Exposed for callers that want to
  do their own widening.
- **`partitionByScope(items, { scopes, getFile, getLine })`** — splits a
  linter's findings into `{ inScope, outOfScope, outOfScopeFiles }`.
  `getFile`/`getLine` default to reading `file`/`fileName` and
  `line`/`lineNumber`, which covers most JSON reporters.
- **`fixableFiles({ files, outOfScopeFiles })`** — the files an auto-fixer
  may safely rewrite, being those with nothing out of scope. A `--fix` pass
  rewrites whole files, so running it on a file that also carries
  pre-existing violations would quietly "fix" lines that match the ref.
- **`mergeRanges(ranges)`** / **`widenRanges(ranges, context)`** — the range
  arithmetic, exposed for testing and for callers with their own ranges.
- **`DEFAULT_CONTEXT_LINES`** — `2`.

### The loop (`loop.js`)

- **`runFixLoop({ input, dir, stateFiles, attemptsFile, maxAttempts, files,
fix, check, onCap, buildMessage, write })`** — the `Stop`/`SubagentStop`
  half described above. `check(files)` must
  return `{ failed, report }`; `fix(files)` is optional and runs first when
  given; `onCap({ files, outcome, maxAttempts })` is optional and runs
  once instead of blocking when the attempt cap is reached;
  `buildMessage({ attempt, maxAttempts, outcome, files })` returns
  `{ stopReason?, systemMessage }` for the block payload, which is printed
  as `{ "decision": "block", "reason": systemMessage, "systemMessage":
stopReason }`: `reason` is what Claude is told to fix (cut to
  `MAX_REASON_CHARS`, since Claude Code would otherwise swap a longer one
  for a short preview), `systemMessage` a notice shown only to the user. `maxAttempts`
  defaults to `DEFAULT_MAX_ATTEMPTS` (3). Returns
  `{ blocked, reason, ... }` so a caller or its tests can assert on which
  path was taken (`'no-input'`, `'no-files'`, `'clean'`, `'cap'`,
  `'blocked'`, or `'error'` if `fix`/`check` threw — in which case the
  session's state is left untouched so the next `Stop` retries, rather than
  either blocking on a broken toolchain or silently discarding progress).
- **`blockPayload({ stopReason, systemMessage })`** — that payload, for
  hooks that block a stop outside `runFixLoop`.
- **`DEFAULT_MAX_ATTEMPTS`** — `3`. **`MAX_REASON_CHARS`** — `9500`.

## Design notes

- **Every module is plain CommonJS with zero runtime dependencies** and no
  build step. Claude Code installs a plugin's dependencies by running
  `npm ci --ignore-scripts` against its own `package-lock.json`, capped at
  60 seconds, when it caches the plugin — a transitive dependency or a
  compile step would risk that budget.
- **State cleanup is additive, never destructive.** `cleanup()` only removes
  the file names it's given; two hooks sharing a session's state directory
  (a tracking hook and, say, this repo's own test-verification hook) can't
  clobber each other.
- **Block with top-level `decision: "block"`.** It is the only shape Claude
  Code honours for `Stop`/`SubagentStop`. Versions of this kit before it
  printed `hookSpecificOutput.decision: "continue"`, which Claude Code
  ignores, so the stop went through and Claude never saw the report.
- **A failing `check`/`fix` is not the same as a failing check.** If either
  throws, `runFixLoop` neither blocks the session nor discards its state —
  a broken toolchain shouldn't trap a session in a loop, and it shouldn't
  look like a clean pass either.

## License

Apache-2.0
