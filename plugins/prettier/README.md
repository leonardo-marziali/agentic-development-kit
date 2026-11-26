# Prettier

[![prettier plugin coverage](https://codecov.io/gh/leonardo-marziali/agentic-development-kit/branch/main/graph/badge.svg?flag=prettier-plugin)](https://codecov.io/gh/leonardo-marziali/agentic-development-kit)

Plugin that formats files with [Prettier][prettier] as Claude edits them.

[prettier]: https://prettier.io/

## What This Plugin Provides

### Formatting Hook

- A `PostToolUse` hook runs `prettier --write --ignore-unknown` on the
  files a tool call just wrote, immediately — no session-tracking, no
  batching. For `Edit`/`Write`/`MultiEdit` that's the file they name; for
  `Bash`, `PowerShell` and MCP tools, a `PreToolUse` snapshot finds
  whatever the call changed (also on `PostToolUseFailure`, for a command
  that wrote files and then failed). A `run_in_background` command's files
  are formatted on later tool calls, for up to 2 hours; what it writes
  after the last tool call isn't. Prettier is fast and deterministic per
  file, so this keeps diffs clean as you go.
- **Only the lines you changed, inside a git repository.** There, only
  Prettier's changes on or near the lines that differ from `HEAD` (plus 2
  lines of context) are written, so an edit to an unformatted file doesn't
  reformat all of it. If applying only some of Prettier's changes would
  leave a file Prettier can't parse, the file is left as it is. Outside a
  repository, for a file git doesn't track yet, or with
  [`whole_files`](#options) on, the whole file is formatted.
- `--ignore-unknown` lets Prettier itself decide whether it has a parser
  for the file; files it doesn't recognize are left untouched.
- Runs from the file's own working directory, so Prettier's own
  `.prettierrc*`/`.prettierignore` discovery (including per-package configs
  in a monorepo) behaves exactly as it would from the command line.
- Non-blocking: if Prettier fails (a parse error, no parser, not
  installed), the hook logs a warning to stderr and exits `0`. A
  formatting failure never blocks the session.
- Paths under `node_modules/` or `.git/` are always skipped.
- Uses `npx prettier`, so it resolves the target project's own installed
  version if present, and still works in a project that hasn't installed
  Prettier itself. The `npx` shim is located next to the running Node
  binary (hooks don't inherit a login shell, so PATH may not have it),
  falling back to a PATH lookup — and on Windows it resolves `npx.cmd` and
  routes through a shell, which Node requires for a batch shim.

### Skills

#### Formatting

- **format** (`/prettier:format [path]`): explicitly format files at
  `path` (or the whole project if omitted), including files this session
  never touched. This is the deliberate escape hatch for formatting
  pre-existing files. Manual invocation only — Claude won't trigger it on
  its own.

## Installation

Add this repository as a plugin marketplace in Claude Code and install
the `prettier` plugin from it, or copy the `plugins/prettier` directory
into your own plugin setup.

## Usage

Once installed, this plugin automatically formats every file Claude edits
or writes. Pre-existing files are never touched by the hook. Run
`/prettier:format [path]` to explicitly format pre-existing files.

### Options

**`whole_files`** — default **off**. Formats whole files even inside a git
repository. Turn it on for a repository that is already Prettier-clean,
where formatting a whole file changes nothing beyond the lines you edited
anyway.

### Configuration

Configure Prettier the normal way, by adding a configuration file to
directories you want formatted a particular way — see [Prettier's
configuration docs][prettier-config]. A `.prettierignore` file excludes
paths from formatting entirely.

[prettier-config]: https://prettier.io/docs/configuration

## Checking changes without the hooks

`scripts/check-changes.js` runs the formatting hook as a changed-lines check
as a standalone command, for where the plugin's hooks can't run: a git
pre-commit hook, CI, or a Claude account whose policy allows managed hooks
only. It shares the hook's code, so it reaches the same verdict on the same
lines.

```sh
node scripts/check-changes.js [--fix] [--format json|text] \
  [--ref <ref>] -- <absolute paths...>
```

A finding is a run of lines Prettier would rewrite on or near the changed
lines — what the hook would write there; rewrites elsewhere count as
`outOfScope`. `whole_files` (as `CLAUDE_PLUGIN_OPTION_WHOLE_FILES`) is
honoured, and files Prettier has no parser for, or `.prettierignore` lists,
are passed over. Lines are scoped against `--ref` (default `HEAD`), widened
by 2 lines; there is no session, so no session base. An untracked file, or
one outside any repository, is checked whole. Paths the plugin wouldn't
check are ignored, never an error.

Without `--fix` nothing is written. With `--fix` each file is formatted
exactly as the hook formats it (only the changed lines, through ad-lfl-kit's
`formatInScope`), then checked again.

`--format json` prints one object on stdout:

```json
{
  "plugin": "prettier",
  "checked": ["/abs/a"],
  "fixed": ["/abs/a"],
  "findings": [
    {
      "file": "/abs/a",
      "line": 12,
      "rule": "…",
      "message": "…",
      "severity": "…"
    }
  ],
  "outOfScope": [{ "file": "/abs/a", "count": 3 }],
  "warnings": ["…"]
}
```

`checked` lists the paths that matched; `fixed` the files `--fix` changed;
`findings` the blocking findings left; `outOfScope` how many pre-existing
findings each file has on lines that didn't change. `--format text` (the
default) prints the report the Stop hook shows Claude on stdout and the
hook's notes on stderr.

Exit codes:

- `0`: nothing blocking is left (after the fix, with `--fix`).
- `1`: blocking findings remain.
- `2`: the check could not run — Prettier missing or failing, or a file it
  can't parse, or a bad argument. A check that did not run is never reported
  as `0`.

## Testing

The hook (`scripts/hooks/format.js`) has a versioned test suite under
`scripts/hooks/__tests__/`, using Node's built-in test runner. The hook's
one runtime dependency, `@leonardo-marziali/ad-lfl-kit`, is pinned in
`package-lock.json`; install it with `npm ci` first — the same install
Claude Code runs when it caches the plugin.

```bash
cd plugins/prettier
npm ci
pnpm test
```

It covers the `Edit`/`Write` matcher, the `node_modules`/`.git` guard,
changed-lines formatting inside a git repository (including untracked and
`.prettierignore`d files and the `whole_files` option), `--ignore-unknown`
behavior for files Prettier can't parse, the
non-blocking exit behavior when Prettier fails, and cross-platform
resolution and quoting of the `npx` shim. These are integration
tests that shell out to the real `npx prettier` (same as the hook does at
runtime). Test scratch directories are created under this repo's own
`.scratch/` (gitignored) rather than the OS temp dir, so `npx`'s local-bin
lookup walks up and finds this repo's root-level `prettier` devDependency
directly — no network access needed to run the suite here.

Coverage uses Node's built-in test-runner coverage (no extra dependency):

```bash
pnpm test:coverage
```

This writes `coverage/lcov.info`, which the
[Plugin Tests](../../.github/workflows/plugin-tests.yml) GitHub Actions
workflow uploads to Codecov under the `prettier-plugin` flag — that's what
the badge above reflects.
