# Markdown

[![markdown plugin coverage](https://codecov.io/gh/leonardo-marziali/agentic-development-kit/branch/main/graph/badge.svg?flag=markdown-plugin)](https://codecov.io/gh/leonardo-marziali/agentic-development-kit)

Plugin that provides documentation skills for Markdown authoring and
linting via markdownlint.

## What This Plugin Provides

### Validation Hooks

- **Session-scoped validation**: only markdown files that were created or
  edited _during the current session_ get linted automatically. Pre-existing
  markdown is left untouched unless you explicitly ask for it (see
  [`/markdown:lint`](#linting) below).
- A tracking hook records every `.md` file the session touches — through
  `Edit`/`Write`, or through `Bash`, `PowerShell` and MCP tools (a
  `PreToolUse` snapshot, then whatever changed when the call ends; a
  `run_in_background` command keeps being tracked for up to 2 hours,
  through the `Stop` hook). `Stop` hooks then run `markdownlint-cli --fix`
  on just that set of files; a subagent's `SubagentStop` on only the
  files that subagent touched.
- **Only the lines you changed, inside a git repository.** There, only
  violations on lines that differ from the commit the session started
  from (plus 2 lines of context) block the stop. Older violations
  elsewhere in the same file are listed once and left alone, and
  `--fix` skips a file that has any, because it rewrites whole files.
  Outside a repository, and for files git doesn't track yet, whole files
  are checked. [`whole_files`](#options) switches back to whole files
  everywhere.
- **Autonomous fix loop**: if violations remain after `--fix`, the `Stop`
  hook blocks the session from ending and hands Claude the remaining
  findings, so it keeps fixing them itself. This repeats up to 3 attempts
  per session before giving up, so a violation nothing can resolve can't
  loop forever.
- **No commits before the check.** While files touched this session are
  still waiting on the `Stop` hook, Claude's `git commit` is denied, so
  unchecked work never reaches history. Ask for the commit again once the
  turn has ended cleanly; your own terminal is never blocked.
- **At the cap, nothing is written to your files by default.** Whatever is
  still failing is reported and the loop stops. Opting into
  [`auto_suppress`](#options) instead has the hook write inline
  `markdownlint-disable` comments for the remainder.
- Once a session's markdown files are clean (or the attempt cap is hit), the
  tracked file list is cleared.

### Skills

This plugin provides the following skills:

#### Linting

- **lint** (`/markdown:lint [path]`): explicitly lint and auto-fix markdown at
  `path` (or the whole project if omitted), including files this session
  never touched. This is the deliberate escape hatch for linting
  pre-existing docs. Manual invocation only — Claude won't trigger it on its
  own.

#### Markdown Fundamentals

- **markdown-syntax-fundamentals**: Core markdown syntax for headings,
  text formatting, lists, links, images, code blocks, and blockquotes
- **markdown-tables**: Table syntax, alignment, escaping, and best
  practices for complex table layouts
- **markdown-documentation**: Writing effective technical documentation,
  READMEs, changelogs, and API docs

#### Markdownlint

- **markdownlint-configuration**: Configure markdownlint rules and
  options including rule management, configuration files, and style
  inheritance
- **markdownlint-custom-rules**: Create custom linting rules including
  rule structure, parser integration, and automatic fixing
- **markdownlint-integration**: Integrate markdownlint into development
  workflows including CLI usage, programmatic API, and CI/CD pipelines

#### Naming convention

Skill names are prefixed with the most specific subject they document, not
mechanically with the plugin name:

- General markdown-format skills use `markdown-` (e.g.
  `markdown-syntax-fundamentals`).
- Skills about a specific tool use that tool's name instead (e.g.
  `markdownlint-configuration`, `marksman-lsp-usage`), since the tool name
  disambiguates better than the plugin name when skills are matched from a
  flat, cross-plugin list.
- User-invocable skills (slash commands) get short verb names with no
  prefix (e.g. `lint`).

## Requirements

This plugin's LSP integration (`.lsp.json`) uses [marksman][marksman] to
provide markdown language server features. Install it before using the
plugin ([marksman installation guide][marksman-install]).

[marksman]: https://github.com/artempyanykh/marksman
[marksman-install]: https://github.com/artempyanykh/marksman/blob/main/docs/installation.md

## Installation

Add this repository as a plugin marketplace in Claude Code and install
the `markdown` plugin from it, or copy the `plugins/markdown` directory
into your own plugin setup.

## Usage

Once installed, this plugin automatically validates markdown files **this
session created or edited**:

- As you edit/write them
- When you finish a conversation with Claude Code (looping on remaining
  issues, up to 3 attempts, before giving up)
- When Claude Code agents complete their work

Pre-existing markdown files are never touched by these hooks. Run
`/markdown:lint [path]` to explicitly lint and fix pre-existing docs.

### Options

The plugin declares two options, prompted when you enable it and
changeable later from the plugin's configuration:

**`auto_suppress`** — default **off**.

When the fix loop hits its 3-attempt cap, this writes inline
`markdownlint-disable` comments into your files for whatever is still
failing. It is off by default: editing your files to silence a linter is
opt-in, and with it off the remaining violations are simply reported. In a
git repository only violations on changed lines are suppressed.

**`whole_files`** — default **off**.

Checks and auto-fixes whole touched files even inside a git repository.
Turn it on for a repository that is already markdownlint-clean, where
whole-file checks cost nothing extra and also catch the case below.

Checking only changed lines has one blind spot. Some violations an edit
causes are reported on a line it didn't touch: delete the last use of a
link reference and MD053 fires on the definition, or rename a heading and
MD051 fires on a link to it elsewhere. These are listed as pre-existing
rather than blocking.

### Configuration

Configure markdownlint by adding a configuration file to directories
you want to lint:

- `.markdownlint.json` or `.markdownlint.jsonc` (JSON format)
- `.markdownlint.yaml` or `.markdownlint.yml` (YAML format)

Example `.markdownlint.json`:

```json
{
  "default": true,
  "MD013": false,
  "MD041": false
}
```

## Checking changes without the hooks

`scripts/check-changes.js` runs the Stop hook's markdownlint check as a
standalone command, for where the plugin's hooks can't run: a git pre-commit
hook, CI, or a Claude account whose policy allows managed hooks only. It
shares the hook's code, so it reaches the same verdict on the same lines.

```sh
node scripts/check-changes.js [--fix] [--format json|text] \
  [--ref <ref>] -- <absolute paths...>
```

It lints the given `.md` files and honours `whole_files` (as
`CLAUDE_PLUGIN_OPTION_WHOLE_FILES`) the way the hook does. Lines are scoped
against `--ref` (default `HEAD`), widened by 2 lines; there is no session,
so no session base. An untracked file, or one outside any repository, is
checked whole. Paths the plugin wouldn't check are ignored, never an error.

Without `--fix` nothing is written. With `--fix`, `markdownlint --fix` runs
once on the files the hook would fix — those with an in-scope violation and
none out of scope — and the files are checked again.

`--format json` prints one object on stdout:

```json
{
  "plugin": "markdown",
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
- `2`: the check could not run — markdownlint missing or crashed, or a bad
  argument. A check that did not run is never reported as `0`.

## Testing

The hooks (`scripts/hooks/track-touched.js`, `scripts/hooks/check-and-loop.js`,
`scripts/hooks/lib.js`) have a versioned test suite under
`scripts/hooks/__tests__/`, using Node's built-in test runner. The hooks'
one runtime dependency, `@leonardo-marziali/ad-lfl-kit`, is pinned in
`package-lock.json`; install it with `npm ci` first — the same install
Claude Code runs when it caches the plugin.

```bash
cd plugins/markdown
npm ci
pnpm test
```

It covers session-scoping (only tracked files get linted, pre-existing ones
never do), changed-lines scoping inside a git repository (including that
`--fix` and auto-suppression leave other lines alone, and the `whole_files`
option), the autonomous fix loop and its 3-attempt cap under both
`auto_suppress` settings, cross-platform resolution of the `npx` shim, and
`.markdownlint.{json,jsonc,yaml,yml}` resolution — including nested/monorepo
configs. The integration tests shell out to the real `npx markdownlint-cli`
(same as the hooks do at runtime), so they need network access or a warm
npx cache and take a few seconds each.

Coverage uses Node's built-in test-runner coverage (no extra dependency):

```bash
pnpm test:coverage
```

This writes `coverage/lcov.info`, which the
[Plugin Tests](../../.github/workflows/plugin-tests.yml) GitHub Actions
workflow uploads to Codecov on every push/PR that touches this plugin —
that's what the badge above reflects.
