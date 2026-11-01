---
name: fix
description: Use when the user asks to "fix editorconfig violations", "apply .editorconfig", "clean up whitespace per editorconfig", or wants .editorconfig fixes applied to files this session never touched. Auto-fixes files, including pre-existing ones, and reports what remains.
argument-hint: '[file paths...] | [natural-language description of files to include]'
disable-model-invocation: true
allowed-tools: Bash(npx -y editorconfig-checker@7.0.0 *) Bash(editorconfig-checker *) Bash(./gradlew editorconfigFormat*) Bash(gradle editorconfigFormat*) Bash(./gradlew editorconfigCheck*) Bash(gradle editorconfigCheck*) Bash(./mvnw editorconfig:format*) Bash(mvn editorconfig:format*) Bash(./mvnw editorconfig:check*) Bash(mvn editorconfig:check*) Bash(git diff *) Bash(git status *) Read Grep Glob
---

# EditorConfig Fix

Apply `.editorconfig` auto-fixes. Arguments given: `$ARGUMENTS`

This skill is the explicit opt-in for fixing **pre-existing** files and lines.
The plugin's hooks never rewrite a file that has violations on lines this
session didn't change; use this skill whenever the user wants those cleaned up
too. Expect whole-file diffs.

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
fixing anything.

If no `.editorconfig` exists at or above the target, say so and stop. Never
create or edit one to make violations go away.

For Markdown files, add `-disable-indent-size` to any `editorconfig-checker`
run, as the hook does: a numbered list's 3-space continuation lines are correct.

## 2. Fix

1. Pick the tool the way the hook does. Search `pom.xml` for
   `editorconfig-maven-plugin` and `build.gradle(.kts)` and
   `settings.gradle(.kts)` for `org.ec4j.editorconfig`.
   - **Maven project, whole-project target**: `./mvnw editorconfig:format` if a
     wrapper exists, otherwise `mvn editorconfig:format`. Check again with
     `editorconfig:check`.
   - **Gradle project, whole-project target**: `./gradlew editorconfigFormat` if
     a wrapper exists, otherwise `gradle editorconfigFormat`. Check again with
     `editorconfigCheck`.
   - **Anything else, including specific paths in a JVM project**:
     `npx -y editorconfig-checker@7.0.0 -no-color --fix <paths>` (or
     `editorconfig-checker` if it's installed). It fixes, then reports what's
     left. With no paths it covers every file git tracks.
2. Report a short summary of what changed (`git diff --stat` over the target
   is enough).
3. List what remains. The checker can't fix indentation, `charset` or
   `max_line_length`. Don't hand-edit those unless the user asks, since that
   can mean a large diff.
