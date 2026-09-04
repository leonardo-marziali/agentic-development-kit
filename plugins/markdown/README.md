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
- A `PostToolUse` hook (on `Edit`/`Write`) records every `.md` file the
  session touches. `Stop` and `SubagentStop` hooks then run
  `markdownlint-cli --fix` on just that set of files.
- **Autonomous fix loop**: if violations remain after `--fix`, the `Stop`
  hook blocks the session from ending and hands Claude the remaining
  findings, so it keeps fixing them itself. This repeats up to 3 attempts
  per session before giving up, so a violation nothing can resolve can't
  loop forever.
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

The plugin declares one option, prompted when you enable it and changeable
later from the plugin's configuration:

**`auto_suppress`** — default **off**.

When the fix loop hits its 3-attempt cap, this writes inline
`markdownlint-disable` comments into your files for whatever is still
failing. It is off by default: editing your files to silence a linter is
opt-in, and with it off the remaining violations are simply reported.

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

## Testing

The hooks (`scripts/hooks/track-touched.js`, `scripts/hooks/check-and-loop.js`,
`scripts/hooks/lib.js`) have a versioned test suite under
`scripts/hooks/__tests__/`, using Node's built-in test runner — no extra
dependencies to install.

```bash
cd plugins/markdown
pnpm test
```

It covers session-scoping (only tracked files get linted, pre-existing ones
never do), the autonomous fix loop and its 3-attempt cap under both
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
