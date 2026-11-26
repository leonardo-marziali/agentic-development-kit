---
name: check
description: Use when the user asks to "check the Java standard", "run the java rules", "check these Java files", "run NullAway / ArchUnit on this", or wants pre-existing Java files checked, not just the lines a session changed. Reports every finding of the plugin's source rules, build-file rules, NullAway and ArchUnit.
argument-hint: '[file paths...] | [natural-language description of files to include]'
disable-model-invocation: true
allowed-tools: Bash(node *) Bash(git diff *) Bash(git status *) Bash(git ls-files *) Read Grep Glob
---

# Java Check

Check Java and build files against the project's Java standard. Arguments
given: `$ARGUMENTS`

The plugin's Stop hook only blocks on lines a session changed. This skill
reports **every** finding in the files it is given, which is what you want
before cleaning up existing code. A project without
`.claude/java-standards.json` is checked with the default settings.

**Only the changed lines?** When the user wants just their changes checked —
the verdict the Stop hook would give, on lines that differ from a commit
(default `HEAD`), ±2 lines — run the plugin's changed-lines command instead
of this skill's steps, with absolute paths:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/check-changes.js" \
  [--fix] [--ref <ref>] -- <absolute paths...>
```

It prints the hook's Java standard report; exit 0 means nothing blocking, 1
blocking findings, 2 the check could not run (say so; never treat 2 as
clean). `--fix` applies the hook's own fixes to those lines first. Without
`--fix` it writes nothing.

## 1. Resolve the target

- **No arguments**: every tracked `.java`, `pom.xml` and `build.gradle(.kts)`
  file (`git ls-files`), minus what `.claude/java-standards.json`'s `exclude`
  patterns (gitignore syntax) leave out.
- **One or more literal file paths (or a directory/glob)**: exactly those
  files. Verify that each exists first; if one doesn't match anything, say
  so instead of silently skipping it.
- **A natural-language description** (e.g. "the files I just edited", "the
  v2 package"): interpret it against the project's files (`git status`,
  `git diff` and directory listings as needed) and resolve it to a concrete
  set of paths before continuing.

**If the natural-language match is ambiguous**, do NOT guess. List the
candidate files with a one-line reason each and ask for confirmation
before checking anything.

## 2. Check

1. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/check.js" <absolute paths...>`.
   Exit code 0 means no findings, 1 means findings (printed by section:
   Source rules, Build files, NullAway, ArchUnit), 2 means it could not run.
   Warnings on stderr say which tool was skipped and why.
2. Summarize the findings by rule ID and offer to fix them. Fix only what
   the user asks for; a rule that genuinely doesn't apply gets
   `// java-rules:allow <ID> <reason>` on that line or the one above.
