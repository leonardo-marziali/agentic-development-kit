---
name: check
description: Use when the user asks to "check editorconfig", "run editorconfig-checker", "find .editorconfig violations", or wants files this session never touched checked against .editorconfig. Reports violations without changing any file.
argument-hint: '[file paths...] | [natural-language description of files to include]'
disable-model-invocation: true
allowed-tools: Bash(npx -y editorconfig-checker@7.0.0 *) Bash(editorconfig-checker *) Bash(./gradlew editorconfigCheck*) Bash(gradle editorconfigCheck*) Bash(./mvnw editorconfig:check*) Bash(mvn editorconfig:check*) Bash(git diff *) Bash(git status *) Read Grep Glob Bash(node *check-changes.js *)
---

# EditorConfig Check

Check files against `.editorconfig`. Arguments given: `$ARGUMENTS`

This skill is the explicit opt-in for checking **pre-existing** files and
lines. The plugin's hooks only ever block on lines this session changed; use
this skill whenever the user wants the wider picture. It changes nothing.

**Only the changed lines?** When the user wants just their changes checked —
the verdict the Stop hook would give, on lines that differ from a commit
(default `HEAD`), ±2 lines — run the plugin's changed-lines command instead
of this skill's steps, with absolute paths:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/check-changes.js" \
  [--fix] [--ref <ref>] -- <absolute paths...>
```

It prints the hook's EditorConfig report; exit 0 means nothing blocking, 1
blocking findings, 2 the check could not run (say so; never treat 2 as
clean). `--fix` applies the hook's own fixes to those lines first. Without
`--fix` it writes nothing.

## 1. Resolve the target

- **No arguments**: target the whole project.
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
checking anything.

If no `.editorconfig` exists at or above the target, say so and stop.

For Markdown files, add `-disable-indent-size` to any `editorconfig-checker`
run, as the hook does: a numbered list's 3-space continuation lines are correct.

## 2. Check

1. Pick the tool the way the hook does. Search `pom.xml` for
   `editorconfig-maven-plugin` and `build.gradle(.kts)` and
   `settings.gradle(.kts)` for `org.ec4j.editorconfig`.
   - **Maven project, whole-project target**: `./mvnw editorconfig:check` if a
     wrapper exists, otherwise `mvn editorconfig:check`.
   - **Gradle project, whole-project target**: `./gradlew editorconfigCheck` if
     a wrapper exists, otherwise `gradle editorconfigCheck`.
   - **Anything else, including specific paths in a JVM project**:
     `npx -y editorconfig-checker@7.0.0 -no-color <paths>` (or
     `editorconfig-checker` if it's installed). With no paths it checks every
     file git tracks.
2. Report violations grouped by file, and say which ones `/editorconfig:fix`
   can repair (trailing whitespace, line endings, final newlines; with ec4j,
   whatever its task can format) and which need manual edits (for the
   checker: indentation, `charset`, `max_line_length`).
3. Mention that `editorconfig-checker` silently skips its default excludes,
   such as lockfiles and `*.min.js`, if a path the user named isn't reported.
