---
name: fix
description: Use when the user asks to fix SonarQube or SonarLint issues, a specific Sonar rule key (like python:S5754 or javascript:S1481), or "the Sonar findings" in some files. Analyzes the target locally, explains each rule, and fixes the issues minimally.
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

Exit 2 means the tool couldn't run. Show stderr and follow the `setup`
skill; don't guess at findings.

## 2. Understand each rule before touching code

```bash
sonarlint rules --key <rule>
```

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
the reason.

## 5. Report

Per rule: what it meant, what you changed, and what is left and why.
