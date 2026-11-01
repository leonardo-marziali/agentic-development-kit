# EditorConfig

[![editorconfig plugin coverage](https://codecov.io/gh/leonardo-marziali/agentic-development-kit/branch/main/graph/badge.svg?flag=editorconfig-plugin)](https://codecov.io/gh/leonardo-marziali/agentic-development-kit)

Plugin that enforces a project's [`.editorconfig`][editorconfig] on the files
Claude edits, in any language.

[editorconfig]: https://editorconfig.org/

## What This Plugin Provides

### Enforcement Hook

- `PreToolUse`, `PostToolUse` and `PostToolUseFailure` hooks track every file
  the session touches, through `Edit`/`Write` or through `Bash`, `PowerShell`
  and MCP tools, in the main conversation or a subagent.
- A `Stop`/`SubagentStop` hook checks those files, auto-fixes what it safely
  can, and blocks the stop if violations remain on changed lines, so Claude
  fixes them. After 3 attempts it reports what's left and lets the stop through.
- **Only changed lines can block.** A violation already committed is reported
  on stderr and left alone. Because a fix rewrites the whole file, a file with
  any such violation skips auto-fix, and Claude fixes the changed lines by hand.
  Outside a git repository, and for new files, the whole file counts.
- Files with no `.editorconfig` at or above them are skipped, and the plugin
  never creates one. Paths under `node_modules/` or `.git/` are always skipped.
- Non-blocking on failure: if the tool can't run (offline, download blocked),
  the hook warns on stderr, says the files were not checked, and exits `0`.

### Which Tool Runs

- **`pom.xml` mentions `editorconfig-maven-plugin`:** `editorconfig:check` and
  `editorconfig:format`.
- **Gradle build or settings mentions `org.ec4j.editorconfig`:**
  `editorconfigCheck` and `editorconfigFormat`.
- **Everything else:** `editorconfig-checker`, and `--fix` to repair.

- Gradle and Maven only run where the project's own build declares the
  [ec4j][ec4j] plugin; this plugin never adds it. The wrapper (`./gradlew`,
  `./mvnw`) is preferred over `gradle`/`mvn` on `PATH`.
- ec4j's tasks work over patterns, so the hook limits them to the session's
  files: `-Deditorconfig.includes` for Maven, an init script for Gradle. If a
  limited check reports any other file, the limit didn't work, so the hook never
  formats and uses `editorconfig-checker` for that project instead. The same
  fallback applies when the build fails or the tool isn't installed, and for
  paths containing `,`, `*` or `?`, which ec4j's includes can't express.
- `editorconfig-checker --fix` covers trailing whitespace, line endings and
  final newlines. Claude fixes indentation, `charset` and `max_line_length`.
- For Markdown, the hook passes `-disable-indent-size`: continuation lines of a
  numbered list align at 3 spaces, which is what Prettier writes and the indent
  check would reject. Tabs against `indent_style = space` are still reported.

[ec4j]: https://github.com/ec4j

### Skills

#### Enforcement

- **check** (`/editorconfig:check [path]`): report violations in `path` (or the
  whole project), including files and lines this session never touched. Changes
  nothing. Manual invocation only.
- **fix** (`/editorconfig:fix [path]`): apply auto-fixes to `path` (or the whole
  project), including pre-existing violations, and list what remains. Expect
  whole-file diffs. Manual invocation only.

#### Configuration

- **editorconfig-configuration**: writing and debugging `.editorconfig` files
  and `editorconfig-checker` exemptions.

## Installation

Add this repository as a plugin marketplace in Claude Code and install the
`editorconfig` plugin from it, or copy the `plugins/editorconfig` directory into
your own plugin setup.

## Requirements

- Node, for the hooks.
- Network access the first time `editorconfig-checker` runs, unless it's already
  on `PATH`. The npm wrapper (`editorconfig-checker@7.0.0`, via `npx`) downloads
  the latest core binary from GitHub releases and caches it. That call is subject
  to GitHub's API rate limit and uses `GITHUB_TOKEN` if set. The wrapper's version
  is pinned but the binary isn't.
- Java and the project's own build tooling, for projects using ec4j.

## Things to Know

- `editorconfig-checker` silently skips its default excludes, such as lockfiles
  and `*.min.js`.
- `trim_trailing_whitespace = true` removes Markdown hard line breaks written as
  two trailing spaces. Add `trim_trailing_whitespace = false` under `[*.md]` if
  you use them.
- Prettier reads some `.editorconfig` settings too. If it and a rule disagree, the
  block message tells Claude to report the conflict rather than alternate.
- Stop hooks from different plugins can run at the same time, so another plugin's
  fixer may touch the same file. A finding that causes is picked up by the next
  loop attempt.

## Testing

```bash
cd plugins/editorconfig && npm ci --ignore-scripts && pnpm test
```

The suite runs the real `editorconfig-checker`, so it needs network access or a
warm `npx` cache. Gradle and Maven are replaced by fake wrapper scripts, which pin
down how the hook drives them, not how ec4j behaves.
