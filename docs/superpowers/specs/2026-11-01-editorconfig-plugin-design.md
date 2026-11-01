# EditorConfig plugin

Date: 2026-11-01

## Summary

Add an `editorconfig` plugin whose hook makes Claude's edits follow a project's
`.editorconfig`, in any language. Prettier reads only some of those settings and
skips file types it doesn't know, and nothing else in the marketplace enforces
them.

## Decisions

- **Scope:** any project, through `editorconfig-checker`. The ec4j Gradle and
  Maven plugins run instead where the project's build already declares them.
- **Timing:** at `Stop`/`SubagentStop`, in the capped fix loop (the `markdown`
  pattern).
- **Strictness:** only uncommitted changed lines can block (the `sonarqube`
  pattern). Older violations are reported and left alone, and their files skip
  auto-fix.
- **Whole-file work:** `/editorconfig:check` and `/editorconfig:fix`,
  manual-only skills in the style of `/prettier:format`.

## Approaches

- **Stop-time loop:** picked. Maps onto `runFixLoop` and starts a JVM only at a
  stop.
- **Fix on every edit plus a Stop loop:** rejected. Adds an `npx` run per edit,
  can't include Gradle or Maven, and runs alongside Prettier's hook on the same
  file.
- **Own fixer on the `editorconfig` npm library:** rejected. Avoids the binary
  download but means reimplementing and maintaining the rules.

## Behavior

For each stop, over the files the session touched that have an `.editorconfig`
above them:

1. Group files by tool: walk up to the repository root looking for a build file
   that declares ec4j, otherwise use the checker.
2. Check, partition findings with `scopesFor` and `partitionByScope`, and
   auto-fix only files with in-scope findings and nothing out of scope.
3. Re-check, and block on what remains in scope. Skip the re-check if nothing
   was fixed.

Tool failures warn on stderr and don't block. A failing Gradle or Maven run
falls back to the checker.

### Keeping format inside the session's files

ec4j's tasks work over include patterns rather than a file list:

- Maven takes `-Deditorconfig.includes`, with `-N` so patterns stay relative to
  one project and `excludeSubmodules=false` so its modules' files aren't
  excluded.
- Gradle's extension has no command-line property, so `narrow-includes.gradle`
  sets it from an init script.

The format task only edits files with violations, and the limited check that
precedes it reports all of those. So if the check reports any file outside the
session, limiting failed and the hook uses the checker for that project without
ever formatting. This holds even if limiting silently stops working in some ec4j
version.

## Verified behavior of `editorconfig-checker`

Observed by running `editorconfig-checker@7.0.0`, which fetched core v4.0.2:

- `--fix` repairs trailing whitespace, line endings and final newlines, and
  reports the rest.
- `-format gcc` prints `<file>:<line>:<col>: error: <message>`, relative to the
  cwd even for absolute arguments. Whole-file findings use line 0, so the hook
  attributes them to the last line.
- Exit 1 means findings, but also a missing file argument, so the hook filters
  to existing files and treats exit 1 without findings as a failure.
- Default excludes (lockfiles, `*.min.js`) are skipped silently.
- The indent-size check rejects Markdown's 3-space list continuation lines,
  which Prettier requires, so Markdown runs with `-disable-indent-size`.
- The wrapper fetches the latest binary through the GitHub API, using
  `GITHUB_TOKEN` if set, and caches it. The wrapper can be pinned; the binary
  can't.

## Not verified against real tools

Running Gradle and Maven wasn't possible in the environment this was built in.
The ec4j output format and the limiting options come from ec4j's source and
documentation, and the tests replace both tools with fake scripts. Run both on a
real sample project before relying on them.
