---
name: format
description: Use when the user asks to "format Java", "format these Java files", "run the Eclipse formatter", or wants Java files the session never touched formatted. Formats whole Java files with the plugin's Eclipse JDT engine and the project's formatter profile, including pre-existing files.
argument-hint: '[file paths...] | [natural-language description of files to include]'
disable-model-invocation: true
allowed-tools: Bash(node *) Bash(git diff *) Bash(git status *) Bash(git ls-files *) Read Grep Glob
---

# Java Format

Format Java files with the plugin's Eclipse JDT engine. Arguments given:
`$ARGUMENTS`

This skill is the explicit opt-in for formatting **whole, pre-existing**
files. The plugin's Stop hook only formats the lines a session changed;
use this skill when the user wants existing files formatted too.

The profile is the project's own: the one `.claude/java-standards.json`
names, else a committed Eclipse formatter export, else
`.settings/org.eclipse.jdt.core.prefs`. Only a project that opted in with
`.claude/java-standards.json` falls back to the plugin's default profile.

## 1. Resolve the target

- **No arguments**: every tracked `.java` file of the repository
  (`git ls-files '*.java'`), minus what `.claude/java-standards.json`'s
  `exclude` patterns (gitignore syntax) leave out.
- **One or more literal file paths (or a directory/glob)**: exactly those
  `.java` files. Verify that each exists first; if one doesn't match
  anything, say so instead of silently skipping it.
- **A natural-language description** (e.g. "the files I just edited", "the
  v2 package"): interpret it against the project's files (`git status`,
  `git diff` and directory listings as needed) and resolve it to a concrete
  set of paths before continuing.

**If the natural-language match is ambiguous** — nothing clearly matches,
or there are several plausible interpretations — do NOT guess. List the
candidate files with a one-line reason each and ask for confirmation
before formatting anything.

## 2. Format

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/format.js" <absolute paths...>`.
   Exit code 2 means nothing could be formatted: no formatter profile (tell
   the user to commit one or opt in with `.claude/java-standards.json`) or
   no engine (run `/java:setup`).
2. Report a short summary of what changed: the script prints each file it
   rewrote, and `git diff --stat` over the target shows the size of the
   change.
