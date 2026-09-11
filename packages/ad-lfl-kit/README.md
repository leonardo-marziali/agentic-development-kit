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

1. A `PostToolUse` hook (matching `Edit`/`Write`) records every file the
   current session touches that matches some predicate — only `.md` files,
   say — into a session-scoped list.
2. A `Stop`/`SubagentStop` hook reads that list, runs a check (optionally
   preceded by an auto-fix pass), and:
   - if it passes, cleans up the session state and lets the session end;
   - if it fails, blocks the stop with `decision: "continue"` so Claude sees
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
as [`plugins/markdown/hooks/hooks.json`](https://github.com/leonardo-marziali/agentic-development-kit/blob/main/plugins/markdown/hooks/hooks.json):
a `PostToolUse` hook on `Edit|Write`, and `Stop`/`SubagentStop` hooks, both
pointed at `${CLAUDE_PLUGIN_ROOT}`.

**`scripts/hooks/track-touched.js`**

```js
#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { readHookInput, stateDir, trackTouchedFile } = require('@leonardo-marziali/ad-lfl-kit');

const input = readHookInput();
if (input) {
  const dir = stateDir({
    sessionId: input.session_id,
    namespace: 'my-plugin-session-scope',
  });
  trackTouchedFile({
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
  readTrackedFiles,
  runFixLoop,
  runBin,
} = require('@leonardo-marziali/ad-lfl-kit');

const input = readHookInput();
const dir = stateDir({
  sessionId: input?.session_id,
  namespace: 'my-plugin-session-scope',
});
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

- **`trackTouchedFile({ input, listFile, matches })`** — the `PostToolUse`
  half. No-ops unless `input.tool_name` is `Edit` or `Write`, the tool's
  `file_path` still exists on disk (resolved against `input.cwd`), and
  `matches(absPath)` returns true (omit `matches` to track everything).
  Returns the tracked absolute path, or `null`.

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

### The loop (`loop.js`)

- **`runFixLoop({ input, dir, stateFiles, attemptsFile, maxAttempts, files,
fix, check, onCap, buildMessage, write })`** — the `Stop`/`SubagentStop`
  half described above. `check(files)` must
  return `{ failed, report }`; `fix(files)` is optional and runs first when
  given; `onCap({ files, outcome, maxAttempts })` is optional and runs
  once instead of blocking when the attempt cap is reached;
  `buildMessage({ attempt, maxAttempts, outcome, files })` returns
  `{ stopReason?, systemMessage }` for the block payload. `maxAttempts`
  defaults to `DEFAULT_MAX_ATTEMPTS` (3). Returns
  `{ blocked, reason, ... }` so a caller or its tests can assert on which
  path was taken (`'no-input'`, `'no-files'`, `'clean'`, `'cap'`,
  `'blocked'`, or `'error'` if `fix`/`check` threw — in which case the
  session's state is left untouched so the next `Stop` retries, rather than
  either blocking on a broken toolchain or silently discarding progress).
- **`DEFAULT_MAX_ATTEMPTS`** — `3`.

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
- **A failing `check`/`fix` is not the same as a failing check.** If either
  throws, `runFixLoop` neither blocks the session nor discards its state —
  a broken toolchain shouldn't trap a session in a loop, and it shouldn't
  look like a clean pass either.

## License

Apache-2.0
