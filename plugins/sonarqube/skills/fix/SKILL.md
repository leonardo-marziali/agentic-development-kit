---
name: fix
description: Use when the user asks to fix SonarQube or SonarLint issues, a specific Sonar rule key (like python:S5754 or githubactions:S8541), or "the Sonar findings" in some files, including issues SonarQube Server or Cloud reported. Gathers findings locally and from the server, explains each rule, and fixes the issues minimally.
argument-hint: '[rule key | file paths...]'
allowed-tools: Bash(node *sonarlint.js *) Read Edit Grep Glob
---

# Fix SonarQube findings

Arguments: `$ARGUMENTS`

`sonarlint` below means:

```bash
node "${CLAUDE_PLUGIN_ROOT}/cli/sonarlint.js" --data-dir "${CLAUDE_PLUGIN_DATA}"
```

## 1. Find what to fix

- **File paths**: `sonarlint files <paths...> --format json --min-severity INFO`.
- **A rule key** (`<repo>:S<number>`): analyze the files the user means,
  or the files changed in the working tree (`git status --porcelain`), and
  keep only that rule.
- **Nothing**: the files changed in the working tree.

If the files sit under a `.sonarlint/connectedMode.json` binding, also
run `sonarlint server <same paths> --format json --min-severity INFO`.
The server can report rules the local engine doesn't have, such as
`githubactions:*` on workflow files. A rule key that local analysis never
reports is usually one of these, so look for it on the server before
saying there's nothing to fix. Merge the two lists as the `analyze` skill
describes. A server finding in a file changed since the server's analysis
(`projects[].changedSinceAnalysis`) may already be fixed or have moved
lines, so check the code first.

Exit 2 means that source couldn't be read. For `files`, show stderr and
follow the `setup` skill. For `server`, say the server wasn't checked
(see `sonarqube-web-api` for login). Don't guess at findings.

## 2. Understand each rule before touching code

```bash
sonarlint rules --key <rule>
```

If the local engine doesn't know the rule (common for server-only
findings), read it from the server instead:
`sonar api get "/api/rules/show?key=<rule>&organization=<org>"` (see
`sonarqube-web-api`).

Read why the rule exists. The fix should remove the reason the rule
fired, not just the pattern it matches.

## 3. Fix minimally

- Change only what the finding is about. No drive-by refactors.
- Prefer the analyzer's own quick fix when the output says one is
  available; it is the change SonarQube for IDE would apply.
- Secrets: move the value out of the file entirely and tell the user it
  must be rotated.
- **Never** add `// NOSONAR`, `# NOSONAR`, or an exclusion unless the user
  explicitly approves that specific suppression. If you believe a finding
  is a false positive, say which one and why, and stop there.

## 4. Re-check

Re-run the same `sonarlint files` command. Stop after two
fix-and-recheck rounds; report anything still open, with its rule key and
the reason. The server shows a fix only after its next analysis, so for
server-only rules, say the fix can't be verified locally.

## 5. Report

Per rule: what it meant, what you changed, and what is left and why.
