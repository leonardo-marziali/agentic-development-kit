---
name: format
description: Use when the user asks to "format with Prettier", "run prettier", "format these files", or wants Prettier run over files this session never touched. Formats files with Prettier, including pre-existing ones.
argument-hint: '[file paths...] | [natural-language description of files to include]'
disable-model-invocation: true
allowed-tools: Bash(npx -y prettier *) Bash(git diff *) Bash(git status *) Read Grep Glob
---

# Prettier Format

Format files with Prettier. Arguments given: `$ARGUMENTS`

This skill is the explicit opt-in for formatting **pre-existing** files —
files this session didn't create or edit. The plugin's hook only ever
formats a file immediately after Claude edits or writes it; use this
skill whenever the user wants existing files formatted too.

## 1. Resolve the target

- **No arguments**: target the whole project (`npx prettier --write
--ignore-unknown .`), letting Prettier's own `.prettierignore` and
  `.gitignore` discovery decide what to skip.
- **One or more literal file paths (or a directory/glob)**: target exactly
  those paths (verify each exists first; if one doesn't match anything, say
  so instead of silently skipping it).
- **A natural-language description** (e.g. "the files I just edited", "the
  configs under plugins/"): interpret it against the project's files (`git
status`/`git diff` and directory listings as needed) and resolve it to a
  concrete set of paths before continuing.

**If the natural-language match is ambiguous** — nothing clearly matches, or
there are multiple plausible interpretations — do NOT guess. List the
candidate files with a one-line reason each and ask for confirmation before
formatting anything.

## 2. Format

1. Run `npx -y prettier --write --ignore-unknown <target>`. Do not pass
   `--config`; let Prettier discover the nearest `.prettierrc*` on its own
   (including per-package configs in a monorepo).
2. Report a short summary of what changed (`git diff --stat` over the
   target is enough — Prettier itself doesn't report which files it
   rewrote).
