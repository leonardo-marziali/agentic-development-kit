---
name: lint
description: Use when the user asks to "lint markdown", "fix markdown lint errors", "run markdownlint", or wants markdownlint run over docs this session never touched. Lints and auto-fixes markdown files, including pre-existing ones.
argument-hint: '[file paths...] | [natural-language description of files to include]'
disable-model-invocation: true
allowed-tools: Bash(npx -y markdownlint-cli *) Read Edit Grep Glob
---

# Markdown Linting

Lint markdown files. Arguments given: `$ARGUMENTS`

This skill is the explicit opt-in for linting **pre-existing** markdown —
files this session didn't create or edit. The plugin's hooks only ever
auto-lint files touched during the current session; use this skill
whenever the user wants existing docs checked or cleaned up too.

## 1. Resolve the target

- **No arguments**: target every `**/*.md` file in the project, excluding
  `node_modules`.
- **One or more literal file paths (or a directory/glob)**: target exactly
  those paths (verify each exists first; if one doesn't match anything, say
  so instead of silently skipping it).
- **A natural-language description** (e.g. "the files I just edited", "the
  docs under plugins/"): interpret it against the project's `.md` files
  (`git status`/`git diff` and directory listings as needed) and resolve it
  to a concrete set of paths before continuing.

**If the natural-language match is ambiguous** — nothing clearly matches, or
there are multiple plausible interpretations — do NOT guess. List the
candidate files with a one-line reason each and ask for confirmation before
linting anything.

## 2. Lint

1. Run `npx -y markdownlint-cli --fix <target>` to auto-fix what markdownlint
   can. Do not pass `-c`/`--config` — let markdownlint discover the nearest
   `.markdownlint.json`, `.markdownlint.jsonc`, `.markdownlint.yaml`, or
   `.markdownlint.yml` on its own.
2. Run `npx -y markdownlint-cli <target>` again (no `--fix`) to see what's left.
3. If violations remain, fix them directly by editing the affected files,
   then re-run step 2. Repeat until markdownlint reports nothing, or until
   you're confident a remaining finding needs a human judgment call — say so
   explicitly instead of guessing.
4. Report a short summary: what got fixed, and anything left unresolved and why.
