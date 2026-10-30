---
name: sonarlint-analysis
user-invocable: false
description: Use after creating or editing source code (JS/TS, Python, Java, Go, PHP, HTML, CSS, XML, Terraform, Docker, Kubernetes, CloudFormation, or any file that could hold a credential) and before declaring a coding task done, or when asked to check code quality or security locally. Runs SonarQube for IDE's own analyzers on the working tree through the plugin's `sonarlint` CLI and explains how to read and act on the result.
allowed-tools: Bash(node *sonarlint.js *) Read Edit Grep Glob
---

# Local SonarQube for IDE analysis

The plugin ships `sonarlint`, a CLI over SonarQube for IDE's engine
(SLOOP) running **locally and offline**. It reports what the IDE
extension would underline: bugs, vulnerabilities, code smells, and
secrets, for the files you name — including uncommitted ones.

Always invoke it exactly like this (the paths are filled in for you):

```bash
node "${CLAUDE_PLUGIN_ROOT}/cli/sonarlint.js" \
  --data-dir "${CLAUDE_PLUGIN_DATA}" <command> ...
```

Below, `sonarlint` stands for that whole prefix.

## When to run it

- After a non-trivial edit, on the files you changed, before you say the
  work is done.
- When the user asks for a quality or security check of specific code.

The plugin's hooks already analyze each edited file and block the end
of the session on serious findings. Running it yourself is for checking
before you hand back, or for files you didn't edit.

## Commands

```bash
sonarlint files src/app.ts src/util/ --format json   # files or directories
sonarlint files src/app.ts --min-severity MEDIUM     # change the exit-1 bar
printf '%s' "$CODE" | sonarlint stdin --path src/new.ts  # content not on disk yet
sonarlint server src/app.ts .github/ --format json   # what the server recorded
sonarlint rules --key python:S5754                   # what a rule means
sonarlint rules --search "unused" --lang JS          # find rule keys
sonarlint doctor                                     # is it installed and healthy?
```

A directory expands to the files git considers part of the project, so
ignored and vendored files stay out.

The first call in a project starts a daemon and takes ~20-30s; later
calls take about a second.

## Reading the result

Text output is one line per issue, worst first, then a summary:

```text
src/config.ts:1  BLOCKER  secrets:S6689  Make sure this GitHub token gets revoked...
src/job.py:4  HIGH  python:S5754  Specify an exception class... (quick fix available)
3 file(s) analyzed, 1 clean, 2 issue(s) in 2 file(s), 2 at/above HIGH
```

`--format json` gives `{issues, summary, skipped, failed}`, where each
issue is `{file, line, endLine, rule, severity, type, message,
hasQuickFix}`.

- **0** — Clean, or only issues below `--min-severity` (default HIGH).
- **1** — Issues at/above the threshold.
- **2** — The tool could not run — read stderr; see the `setup` skill.

Exit 2 is **not** clean. Never report "no issues" for it.

Local clean isn't the same as server clean. The local engine has a
pinned rule set. It can accept a file it has no rules for, such as a
GitHub Actions workflow (the server's `githubactions:*` rules aren't in
it), and report it clean. When the project has a
`.sonarlint/connectedMode.json`, `sonarlint server <paths>` returns the
server's open issues for the same files, in the same shape, with the
revision the server last analyzed. The `analyze` skill describes how to
merge the two.

Severities: `BLOCKER` > `CRITICAL`/`HIGH` > `MAJOR`/`MEDIUM` >
`MINOR`/`LOW` > `INFO`.

## What to do with findings

- **Secrets (`secrets:*`)**: always fix. Remove the value, read it from
  the environment or a secret store, and tell the user it must be
  rotated. Never echo the secret back.
- **BLOCKER, CRITICAL/HIGH**: fix before finishing.
- **MAJOR/MEDIUM and below**: fix when they're in code you just wrote
  and the fix is local; otherwise mention them.

Use `sonarlint rules --key <rule>` when a message isn't self-explanatory.
See `sonarqube-issue-triage` for false positives and suppressions. Never
add `NOSONAR` on your own.

## Avoiding loops

Fix, re-run on the same files, and stop after **two** fix-and-recheck
rounds. If something is still there, report it to the user with the rule
key and why you left it, rather than rewriting code a third time.

## Related skills

- `fix` (`/sonarqube:fix`) — work through findings on request.
- `setup` (`/sonarqube:setup`) — install or repair the engine.
- `sonarqube-web-api` — anything else the server knows about the
  project (hotspots, quality gate, measures), and logging the `sonar`
  CLI in, which `sonarlint server` depends on.
