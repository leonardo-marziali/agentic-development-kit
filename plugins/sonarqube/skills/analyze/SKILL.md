---
name: analyze
description: Use when the user asks to "run sonar", "run SonarQube", "scan for secrets", "check this for Sonar issues", or wants SonarQube analysis over code this session never touched. Runs the sonar CLI and works through the findings.
argument-hint: '[file paths...] | [natural-language description of files to include]'
disable-model-invocation: true
allowed-tools: Bash(sonar analyze *) Read Edit Grep Glob
---

# SonarQube Analysis

Run SonarQube analysis. Arguments given: `$ARGUMENTS`

This skill is the explicit opt-in for analysing **pre-existing** code —
files this session didn't create or edit. The plugin's hooks only ever
analyse files touched during the current session; use this skill whenever
the user wants existing code scanned too.

Requires the `sonar` CLI on PATH. If it isn't installed, say so and stop —
do not try to install it.

## 1. Resolve the target

- **No arguments**: target the current project directory.
- **One or more literal paths (or a directory/glob)**: target exactly
  those (verify each exists first; if one matches nothing, say so instead
  of silently skipping it).
- **A natural-language description** (e.g. "the files I just changed",
  "everything under src/"): resolve it against the repository — using
  `git status` / `git diff` and directory listings — to a concrete set of
  paths before continuing.

**If the match is ambiguous**, do NOT guess. List the candidates with a
one-line reason each and ask for confirmation before analysing anything.

### Narrow it to source the project actually owns

Use git as the source of truth, the way SonarQube for IDE does: analyse
**tracked** files only. `git ls-files` over the resolved target gives
exactly that, and because it already honours `.gitignore`, vendored
dependencies and generated output fall away on their own — with nobody
maintaining a list of directory names that goes stale. `git check-ignore`
settles an individual path.

Outside a git repository, apply the same judgment by hand. Don't reach
for a fixed list of folder names; ask what the file _is_, and skip
anything that isn't source this project wrote and maintains:

- Installed or vendored third-party packages.
- Build, bundle, and distribution output — anything generated from the
  source rather than written by hand.
- Test, coverage, and other tool reports; caches and logs.
- Minified or generated files, lockfiles, and large binary assets.

Analyse a file the user explicitly names even if it would normally be
skipped — but say that you're including it, and why.

## 2. Find the project binding

Look for `.sonarlint/connectedMode.json` at or above the target. If one
exists, read `projectKey` from it and pass it as `--project`, running the
CLI with its working directory set to the directory holding
`.sonarlint/`. See the `sonarqube-connected-mode` skill for the details,
including monorepos with more than one binding.

Without a binding, run without `--project`.

## 3. Analyse

1. **Secrets first**. The scan is local — it sends no code anywhere and
   works against an unreachable server — though the CLI still needs
   credentials configured before it will run anything:

   ```bash
   sonar analyze secrets <paths...>
   ```

2. **Then the full analysis**, once per binding group:

   ```bash
   sonar analyze --file <path> [--file <path>...] --format json
   ```

   Add `--project <key>` when a binding was found, and `--depth DEEP`
   only if the user asks for a more thorough pass — it is noticeably
   slower.

Read the exit code — it is the result, not the output:

| Exit | Meaning                           | What to do                    |
| ---- | --------------------------------- | ----------------------------- |
| 0    | Clean                             | Report nothing found          |
| 51   | Findings, or failed quality gate  | Triage and fix (step 4)       |
| 1    | Command, auth, or network failure | Report it; `sonar auth login` |
| 2    | Invalid options                   | Fix the invocation and retry  |
| 130  | Interrupted                       | Say it was interrupted        |

Exit `1` is **not** a clean result. Never report "no issues found" for it.

## 4. Triage and fix

Work through the findings using the `sonarqube-issue-triage` skill's
severity ordering and false-positive rules. In short:

- **Secrets are the top priority.** Remove the credential from the file,
  move it to an environment variable or a secret store, and tell the user
  it must be **rotated** — it has already been written to disk and may be
  in git history. Never treat a secret as a false positive without the
  user explicitly confirming it is a fixture value.
- Fix real issues in the source. Do not rewrite code purely to dodge a
  rule, and do not add `NOSONAR` comments to make findings disappear.
- If a finding is genuinely a false positive, say which one and why, and
  let the user decide. Marking issues resolved on the server is a
  deliberate action — see the `sonarqube-mcp-usage` skill.

Re-run the analysis after fixing, and repeat until clean or until
something needs a human judgment call.

## 5. Report

A short summary: what was scanned, what was found by severity, what was
fixed, and anything left unresolved and why. Call out explicitly any
stage that could not run (an unauthenticated CLI, an unreachable server)
so "clean" is never confused with "not checked".
