# Python

[![python plugin coverage](https://codecov.io/gh/leonardo-marziali/agentic-development-kit/branch/main/graph/badge.svg?flag=python-plugin)](https://codecov.io/gh/leonardo-marziali/agentic-development-kit)

Plugin that formats and lints Python with [ruff][ruff], type-checks it with
[pyright][pyright], and provides pyright's language server through the
`pyright-lsp` plugin.

## What This Plugin Provides

### Format on edit

A `PostToolUse` hook (on `Edit`/`Write`) runs `ruff format` on each `.py` /
`.pyi` file the moment Claude writes it, the same as the
[prettier plugin](../prettier/README.md) does for other files. Files under
`.venv`, `venv`, `site-packages`, `__pycache__`, `node_modules`, and `.git`
are never touched, and neither are files the project's ruff `exclude`
covers.

### Lint and type-check fix loop

- **Session-scoped**: only Python files created or edited _during the
  current session_ are checked. Pre-existing code is left alone unless you
  explicitly ask (see [Skills](#skills)).
- A tracking hook records every Python file the session touches — through
  `Edit`/`Write`, or through `Bash`, `PowerShell` and MCP tools (a
  `PreToolUse` snapshot, then whatever changed when the call ends,
  including on a failed command; a `run_in_background` command keeps
  being tracked for up to 2 hours, through the `Stop` hook). `Stop` hooks
  then run, on just those
  files; a subagent's `SubagentStop` runs on only the files that subagent
  touched:
  1. `ruff check --fix` and `ruff format`, which apply ruff's safe fixes;
  2. `ruff check`, to see what is left;
  3. `pyright`, once per project config (see
     [Configuration](#configuration)).
- **Autonomous fix loop**: if ruff findings or pyright **errors** remain,
  the `Stop` hook blocks the session from ending and hands Claude both
  reports in one message, so it keeps fixing them itself. Both tools share
  one attempt counter, capped at 3 per session, so a finding nothing can
  resolve can't loop forever. Pyright warnings and information never block.
- **At the cap, nothing is written to your files by default.** Whatever is
  still failing is reported and the loop stops. If you opt into
  [`auto_suppress`](#options), the hook instead writes
  `# pyright: ignore[<rule>]` and `# noqa: <CODE>` comments for the
  remainder.
- **Fails open**: if ruff or pyright can't be found, or fails for a reason
  other than findings (a broken config, for instance), that tool is skipped
  with a note on stderr. A broken toolchain never blocks a session.

### Language server

The plugin declares `pyright-lsp@claude-plugins-official` as a dependency,
so installing it also installs that plugin, which registers
`pyright-langserver` for the `LSP` tool. The hooks and the language server
share the project's pyright config.

### Skills

#### Commands

Manual invocation only; Claude won't trigger these on its own. Each takes
file paths, a directory, or a natural-language description of files (the
same arguments as [`/markdown:lint`](../markdown/README.md#linting)), and
targets the whole project when given nothing.

- **lint** (`/python:lint [path]`): `ruff check --fix`, `ruff format`,
  then fixes whatever ruff still reports.
- **format** (`/python:format [path]`): `ruff format`.
- **typecheck** (`/python:typecheck [path]`): runs pyright and fixes the
  errors it reports.

#### Reference

- **ruff-configuration**: `[tool.ruff]` / `ruff.toml`, rule selection,
  per-file ignores, formatter options, `extend`, and `noqa`.
- **pyright-configuration**: `pyrightconfig.json` / `[tool.pyright]`,
  `typeCheckingMode`, virtualenvs, rule overrides, and inline ignores.
- **pyright-lsp-usage**: which `LSP` tool operations pyright supports, and
  when to use them instead of grep.

## Requirements

The hooks look for each tool in this order, and use the first one they
find:

| Tool    | 1. Project venv     | 2. `PATH` | 3. Fallback      |
| ------- | ------------------- | --------- | ---------------- |
| ruff    | `.venv/bin/ruff`    | `ruff`    | `uvx ruff`       |
| pyright | `.venv/bin/pyright` | `pyright` | `npx -y pyright` |

The project venv is the nearest `.venv` above the file, so a version the
project pins always wins. The `pyright-lsp` dependency needs
`pyright-langserver` on `PATH`. `npm install -g pyright` or
`pipx install pyright` provides it, along with the `pyright` CLI.

## Installation

Add this repository as a plugin marketplace in Claude Code and install the
`python` plugin from it:

```text
/plugin marketplace add leonardo-marziali/agentic-development-kit
/plugin install python@agentic-development-kit
```

`pyright-lsp@claude-plugins-official` is installed with it as a dependency.

## Options

**`auto_suppress`** (default **off**). When the fix loop hits its
3-attempt cap, this option writes inline comments for whatever is still
failing:

- pyright: `# pyright: ignore[<rule>]`. Errors without a rule name (syntax
  errors, mostly) are only reported.
- ruff: `# noqa: <CODE>`, written with `ruff check --add-noqa`.

It is off by default because editing your files to silence a checker
should be opt-in. With it off, the remaining findings are simply reported.

## Configuration

Both tools read the project's own config. The plugin passes no rule
options of its own.

- **ruff** uses the nearest `.ruff.toml`, `ruff.toml`, or `pyproject.toml`
  with `[tool.ruff]` for each file. The hooks pass `--force-exclude`, so
  `exclude` / `extend-exclude` apply even to files Claude edits directly.
- **pyright** reads one config per run. Touched files are grouped by their
  nearest `pyrightconfig.json` or `pyproject.toml`, and pyright runs once
  per group with `-p` pointed there. When that directory has a `.venv` and
  its config doesn't name a `venv`, the hook passes `--pythonpath` to the
  venv's interpreter, so the project's installed packages resolve.

To stop a pyright rule from blocking sessions without hiding it, demote it
in the config:

```toml
[tool.pyright]
reportMissingTypeStubs = "warning"
```

## Testing

The hooks have a test suite under `scripts/hooks/__tests__/`, using Node's
built-in test runner. Install the hooks' one runtime dependency,
`@leonardo-marziali/ad-lfl-kit`, with `npm ci` first. This is the same
install Claude Code runs when it caches the plugin.

```bash
cd plugins/python
npm ci
pnpm test
```

The integration tests run the real `ruff` and `pyright`, the same as the
hooks do at runtime. If ruff isn't installed, they skip locally, but they
fail in CI (`CI` set). Pyright falls back to `npx -y pyright`, so on a
cold machine the first run needs network access.

The suite covers:

- format-on-edit, including config and `exclude` handling and the venv
  lookup order;
- session scoping;
- the fix loop: safe ruff fixes, blocking on ruff and pyright findings,
  pyright warnings not blocking, and per-package pyright configs;
- the 3-attempt cap under both `auto_suppress` settings;
- failing open when ruff is missing.

Coverage:

```bash
pnpm test:coverage
```

[ruff]: https://docs.astral.sh/ruff/
[pyright]: https://microsoft.github.io/pyright/
