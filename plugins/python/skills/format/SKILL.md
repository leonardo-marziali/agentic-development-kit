---
name: format
description: Use when the user asks to "format python", "run ruff format", "format these files", or wants ruff's formatter run over Python files this session never touched. Formats Python files with ruff, including pre-existing ones.
argument-hint: '[file paths...] | [natural-language description of files to include]'
disable-model-invocation: true
allowed-tools: Bash(ruff *) Bash(uvx ruff *) Bash(.venv/bin/ruff *) Bash(git diff *) Bash(git status *) Read Grep Glob
---

# Python Format

Format Python files with `ruff format`. Arguments given: `$ARGUMENTS`

This skill is the explicit opt-in for formatting **pre-existing** files —
files this session didn't create or edit. The plugin's hook only ever
formats a Python file immediately after Claude edits or writes it; use
this skill whenever the user wants existing files formatted too.

## 1. Pick the ruff binary

Use the first of these that works: the project's `.venv/bin/ruff`, then
`ruff` on `PATH`, then `uvx ruff`. If none is available, say so and stop.

## 2. Resolve the target

- **No arguments**: target the whole project (`ruff format .`), letting
  ruff's own `exclude` and `.gitignore` discovery decide what to skip.
- **One or more literal file paths (or a directory/glob)**: target exactly
  those paths. Verify that each one exists first. If one doesn't match
  anything, say so instead of silently skipping it.
- **A natural-language description** (e.g. "the files I just edited", "the
  tests"): interpret it against the project's files (`git status`/`git
diff` and directory listings as needed) and resolve it to a concrete set
  of paths before continuing.

**If the natural-language match is ambiguous** (nothing clearly matches,
or there are several plausible interpretations), do NOT guess. List the
candidate files with a one-line reason each and ask for confirmation
before formatting anything.

## 3. Format

1. Run `ruff format --force-exclude <target>`. Do not pass `--config`.
   Let ruff discover the nearest `pyproject.toml` / `ruff.toml` on its
   own, including per-package configs in a monorepo.
2. Report a short summary of what changed. `ruff format` prints counts,
   and `git diff --stat` over the target shows which files.
