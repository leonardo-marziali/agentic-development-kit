---
name: analyze
description: Use when the user asks to "run sonar", "run SonarQube", "run SonarLint", "scan for secrets", "check this for Sonar issues", or wants SonarQube analysis over code this session never touched. Runs SonarQube for IDE's engine locally, adds what SonarQube Server or Cloud recorded for the same files, and works through the findings.
argument-hint: '[file paths...] | [natural-language description of files to include]'
disable-model-invocation: true
allowed-tools: Bash(node *sonarlint.js *) Read Edit Grep Glob
---

# SonarQube Analysis

Run SonarQube analysis. Arguments given: `$ARGUMENTS`

This skill is the explicit opt-in for analysing **pre-existing** code —
files this session didn't create or edit. The plugin's hooks only ever
analyse files touched during the current session; use this skill whenever
the user wants existing code scanned too.

It runs SonarQube for IDE's own analyzers locally (SLOOP) through the
plugin's CLI and, when the project is bound to SonarQube Server or Cloud,
also reads the server's open issues for the same files. `sonarlint` below
means:

```bash
node "${CLAUDE_PLUGIN_ROOT}/cli/sonarlint.js" --data-dir "${CLAUDE_PLUGIN_DATA}"
```

If it exits 2 saying SLOOP is not installed, tell the user and offer
`/sonarqube:setup`. Don't install anything without asking. The server
check in step 3 doesn't need the engine, so still run it.

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

## 2. Analyse

Pass the files (or directories) in one call. A directory expands to what
git considers part of the project.

```bash
sonarlint files <paths...> --format json --min-severity INFO
```

Secrets are part of the same pass: the secrets analyzer is local and
content-based, so it covers `.env`, config, and IaC files too.

Read the exit code — it is the result, not the output:

- **0** — Clean, or only issues below the threshold. Report what was found, if
  anything.
- **1** — Issues at/above `--min-severity`. Triage and fix (step 4).
- **2** — The tool could not run. Show stderr; see `/sonarqube:setup`.

Exit `2` is **not** a clean result. Never report "no issues found" for it.

The first analysis in a project takes ~20-30s while the engine starts;
later ones take about a second.

## 3. Check the server

Local analysis alone is not the full answer. The server runs newer
analyzers, your organization's quality profile, and rules the local
engine never runs (security hotspots, taint analysis). Some files only
the server can check. For example, the pinned engine accepts GitHub
Actions workflows but has no `githubactions:*` rules, so it reports them
clean whatever they contain.

So whenever any target file sits under a `.sonarlint/connectedMode.json`
binding, also ask the server about the same paths:

```bash
sonarlint server <paths...> --format json --min-severity INFO
```

It finds the nearest binding for each file, calls `sonar api` with the
project key (and Cloud organization), and returns the open issues in the
same shape as `files`, plus each issue's server `key` and status. It
also returns a `projects` list giving the revision the server last
analyzed, whether that revision is `HEAD`, and which of the files changed
since then. Add `--branch <name>` or `--pull-request <key>` when the user
cares about something other than the main branch.

- **0 / 1**: same meaning as for `files`.
- **2**: the server couldn't be read: the `sonar` CLI is missing or not
  logged in (see `sonarqube-web-api`), the call failed, no file is
  bound, or the server has no analysis of that project key, branch or
  pull request (it answers those with an empty issue list, so an empty
  list alone proves nothing). Say the server was **not checked** and why. Local results still
  stand.

With no binding at all, skip this step and say only local analysis ran.
Don't create a binding unprompted (see `sonarqube-connected-mode`).

### Merging the two

Treat findings with the same rule, file and line as one finding. For the
rest:

- **Server only, file unchanged since the analysis**: a real open issue.
  Usually the local engine lacks the rule: `sonarlint rules --key <rule>`
  fails, or the rule's language isn't local at all. Fix it like any
  other finding.
- **Server only, file changed since the analysis**: it may already be
  fixed, or its line may have moved. Read the code at and around the
  reported line before acting.
- **Local only**: new code the server hasn't analyzed yet, or a rule your
  quality profile disables (see the README's known limitations). Report
  it; don't drop it.

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
  deliberate action — see the `sonarqube-web-api` skill.

Re-run the local analysis after fixing. Stop after two fix-and-recheck
rounds, or sooner if something needs a human judgment call. Re-running
`sonarlint server` doesn't show your fix: the server only sees it after
its next analysis. Say which fixes can only be confirmed by that
analysis.

## 5. Report

A short summary: what was scanned, what was found by severity and where
it came from (local, server, or both), what was fixed, and anything left
unresolved and why. Call out explicitly any file that was skipped, any
analyzer that could not load, and whether the server was checked (and of
which revision), so "clean" is never confused with "not checked". A file
is clean only if the local run passed and the server either reports
nothing for it or was checked and is up to date. Never call a file clean
on the local result alone when only the server has rules for it.
