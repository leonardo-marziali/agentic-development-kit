---
name: typecheck
description: Use when the user asks to "type check", "run pyright", "fix type errors", or wants pyright run over Python files this session never touched. Type-checks Python files with pyright, including pre-existing ones, and fixes the errors.
argument-hint: '[file paths...] | [natural-language description of files to include]'
disable-model-invocation: true
allowed-tools: Bash(pyright *) Bash(npx -y pyright *) Bash(.venv/bin/pyright *) Bash(git diff *) Bash(git status *) Read Edit Grep Glob
---

# Python Type Check

Type-check Python files with pyright. Arguments given: `$ARGUMENTS`

This skill is the explicit opt-in for type-checking **pre-existing**
code — files this session didn't create or edit. The plugin's Stop hook
only ever checks files touched during the current session; use this
skill whenever the user wants existing code checked too.

## 1. Pick the pyright binary

Use the first of these that works: the project's `.venv/bin/pyright`,
then `pyright` on `PATH`, then `npx -y pyright`.

If the project has a `.venv` and its config sets neither `venv` nor
`venvPath`, pass `--pythonpath .venv/bin/python` so that pyright resolves
the project's installed packages instead of reporting every third-party
import as missing.

## 2. Resolve the target

- **No arguments**: run `pyright` with no file arguments. Pyright checks
  the project as its `pyrightconfig.json` / `[tool.pyright]` defines it
  (`include`, `exclude`, `strict`, and so on).
- **One or more literal file paths (or a directory)**: target exactly
  those paths. Verify that each one exists first. If one doesn't match
  anything, say so instead of silently skipping it.
- **A natural-language description** (e.g. "the files I just edited", "the
  api package"): interpret it against the project's `.py`/`.pyi` files
  (`git status`/`git diff` and directory listings as needed) and resolve
  it to a concrete set of paths before continuing.

**If the natural-language match is ambiguous** (nothing clearly matches,
or there are several plausible interpretations), do NOT guess. List the
candidate files with a one-line reason each and ask for confirmation
before checking anything.

In a monorepo with several configs, run pyright once per package with
`-p <package dir>`. Pyright reads exactly one config per run.

## 3. Check and fix

1. Run pyright over the target. Do not override the project's
   `typeCheckingMode` or rule settings on the command line.
2. Fix **errors** by correcting the code or its annotations. Warnings and
   information are worth mentioning but don't need to reach zero unless
   the user asks.
3. Re-run until no errors remain, or until a remaining error needs a human
   judgment call. Say so explicitly instead of guessing.
4. Suppress only when a correct fix is impossible (e.g. an untyped
   third-party library). Use a targeted `# pyright: ignore[<rule>]` on
   the offending line, never a bare `# type: ignore`, and never weaken
   the project config to make errors go away.
5. Report a short summary: the error count before and after, what changed,
   and anything left unresolved and why.
