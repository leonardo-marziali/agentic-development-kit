# Contributing

Thanks for looking to contribute. This document covers the git workflow:
how to branch, commit, open a pull request, and get it merged. For
environment setup, running tests, and CI details, see the
[README](README.md#development).

If you're a coding agent rather than a human contributor, read
[AGENT.md](AGENT.md) instead — it covers the same workflow with agent-specific
detail (skills that automate parts of it, and stricter defaults).

## Branch protection

`main` is a protected branch:

- **No direct pushes.** Every change lands via a pull request — this is
  enforced both by a GitHub repository ruleset and, locally, by a
  `pre-push` Husky hook.
- **No force pushes to `main`**, for the same reason.

To make a change, branch from `main`, commit your work, and open a pull
request.

### Branch naming

Branch names follow GitHub flow:

```text
<type>/<short-description>
```

- `<type>` is one of the [Conventional Commits](https://www.conventionalcommits.org/)
  types this repo uses (see `commitlint.config.js`): `build`, `chore`,
  `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`,
  `test`.
- `<short-description>` is lowercase kebab-case, 2–5 words, under ~40
  characters total.

Example: `feat/webhook-retries`.

## Commits

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/),
enforced locally by `commitlint` via a Husky `commit-msg` hook — a commit
that doesn't match the format is rejected before it's created.

## Opening a pull request

Push your branch and open a pull request against `main`. Two checks run
automatically:

- [`plugin-tests.yml`](.github/workflows/plugin-tests.yml) — runs the test
  suites affected by your change.
- [`pr-title.yml`](.github/workflows/pr-title.yml) — checks that the **PR
  title** itself follows Conventional Commits, using the same type
  vocabulary as commits. This matters beyond style: on merge, the squashed
  commit on `main` reuses the PR title (see "Merging" below), and
  semantic-release reads that history to decide the next version — a
  malformed title breaks that automation.

### Description template

Fill in the pull request description using this template. Skip a section
if it has nothing to say (drop the heading entirely for **Screenshots**
and **Breaking changes**; leave `N/A` for the rest) rather than leaving it
empty with no explanation.

```markdown
## Summary

One or two sentences: what changes and why it is needed. Written for a
reviewer who has not read the branch.

## Changes

- The substantive changes, one bullet each, grouped by area.
- Behaviour first, mechanics second. Skip pure noise (formatting,
  generated files) unless a reviewer needs to know it is there.

## Motivation

Links: `Closes #123`, the spec or design doc by repository path, related
PRs. Also the decisions a reviewer would otherwise ask about — an approach
considered and rejected, a constraint that forced an odd shape.

## Screenshots (if UI change)

## Test plan

What was actually run to verify this, in checklist form. Distinguish
automated from manual so a reviewer knows what CI already proves versus
what they'd need to redo by hand.

- [ ] Unit/integration tests: `path/to/test_file` — what they cover
- [ ] E2E: `path/to/e2e_spec` — what they cover, or "none yet, gap noted below"
- [ ] Manual: steps a reviewer can reproduce locally
  1. ...
  2. ...
  3. Expected result: ...
- [ ] Edge cases exercised: empty input, expired/stale state, concurrent
      writes, permission boundaries — whichever apply
- [ ] Verified in an environment close to prod (staging, feature flag on
      in prod, etc.) if the change is risky enough to warrant it

## Checklist

- [ ] Tests added/updated, and they fail on `main` without this change
- [ ] Rollback is safe (revert, or flag off) with no data migration to undo
- [ ] Logs/metrics/alerts updated if this changes error paths or SLOs
- [ ] Docs updated (README, API docs, runbook) — or N/A
- [ ] No secrets, debug code, or commented-out blocks left in
- [ ] No breaking changes (or noted below)

## Breaking changes

Only when there are any: what breaks, and what a consumer must do about
it. Mirror the `BREAKING CHANGE:` footer from the commit.
```

Only check off a `Test plan` or `Checklist` box for something you actually
did — an unchecked box with a one-line reason is more useful to a reviewer
than a box ticked to look complete.

The `github` plugin's `pr` skill fills this template in automatically from
the branch's commits, diff, and any linked issue, delegating that work to
the `git` plugin's
[`pr-description`](plugins/git/skills/pr-description/SKILL.md) skill — see
that skill for how it derives the content.

## Merging

**Squash merge** is this repository's merge strategy. Merging a pull
request collapses it into a single commit on `main`, titled from the PR
title — which is why the PR title must be a valid Conventional Commit on
its own, independent of the individual commit messages on the branch.

Once merged:

- Delete the branch (the merge UI offers this as one click).
- [`release.yml`](.github/workflows/release.yml) runs automatically on the
  resulting push to `main` and, via semantic-release, decides the next
  version from the Conventional Commit history and cuts a release. No
  manual version bump or tag is needed.
