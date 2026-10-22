---
name: lint
description: Use when the user asks to "lint python", "run ruff", "fix ruff errors", or wants ruff run over Python files this session never touched. Lints, auto-fixes and formats Python files with ruff, including pre-existing ones.
argument-hint: '[file paths...] | [natural-language description of files to include]'
disable-model-invocation: true
allowed-tools: Bash(ruff *) Bash(uvx ruff *) Bash(.venv/bin/ruff *) Bash(git diff *) Bash(git status *) Read Edit Grep Glob
---

# Python Linting

Lint Python files with ruff. Arguments given: `$ARGUMENTS`

This skill is the explicit opt-in for linting **pre-existing** Python —
files this session didn't create or edit. The plugin's hooks only ever
auto-lint files touched during the current session; use this skill
whenever the user wants existing code checked or cleaned up too.

## 1. Pick the ruff binary

Use the first of these that works, the same order the hooks use:

1. `.venv/bin/ruff` in the project (the version the project pins).
2. `ruff` on `PATH`.
3. `uvx ruff`.

If none is available, say so and stop. Don't install anything without
asking.

## 2. Resolve the target

- **No arguments**: target the whole project (`.`). Ruff's own discovery
  respects `exclude`, `extend-exclude`, and `.gitignore`.
- **One or more literal file paths (or a directory/glob)**: target exactly
  those paths. Verify that each one exists first. If one doesn't match
  anything, say so instead of silently skipping it.
- **A natural-language description** (e.g. "the files I just edited", "the
  code under src/api"): interpret it against the project's `.py`/`.pyi`
  files (`git status`/`git diff` and directory listings as needed) and
  resolve it to a concrete set of paths before continuing.

**If the natural-language match is ambiguous** (nothing clearly matches,
or there are several plausible interpretations), do NOT guess. List the
candidate files with a one-line reason each and ask for confirmation
before linting anything.

## 3. Lint

1. Run `ruff check --fix --force-exclude <target>` to apply ruff's safe
   fixes. Do not pass `--config` or `--unsafe-fixes`. Let ruff discover
   the nearest `pyproject.toml`, `ruff.toml`, or `.ruff.toml` on its own.
2. Run `ruff format --force-exclude <target>`, because fixes can leave code
   unformatted.
3. Run `ruff check --force-exclude --output-format=concise <target>` to see
   what's left.
4. If violations remain, fix them directly by editing the affected files,
   then re-run step 3. Repeat until ruff reports nothing, or until you're
   confident that a remaining finding needs a human judgment call. Say so
   explicitly instead of guessing. A finding that can only be "fixed" by
   writing wrong code gets a targeted `# noqa: <CODE>` with a short reason,
   never a blanket `# noqa`.
5. Report a short summary: what got fixed (`git diff --stat` over the
   target), and anything left unresolved and why.
