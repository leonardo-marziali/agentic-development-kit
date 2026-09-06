---
name: pr-description
user-invocable: false
description: This skill should be used by a hosting-specific pull/merge request skill (such as the `github` plugin's `pr` skill, or an equivalent for GitLab/Bitbucket) whenever it needs to derive a Conventional Commits title and a description for a whole branch. It is vendor-agnostic — it never talks to a host API or CLI — and only produces the title and body text; the calling skill is responsible for actually opening or updating the pull/merge request. Triggers on "derive a PR title from this branch", "write the PR description", "compose the pull request body", or a caller needing that content before it can call a host's create/update API.
---

# Deriving the title and description

The pull request has to describe the branch to someone who did not write
it. Everything below is about finding what the branch already says about
itself, in the repository, before writing a word.

## 1. Gather the evidence

Work through these in order. Later sources add colour; earlier ones settle
disputes.

### The commits

```bash
git log --reverse --format='%H%n%s%n%b%n---' <remote>/<base>..HEAD
```

Read the bodies, not just the subjects. Commit bodies are where the
reasoning usually lives, and footers (`Refs:`, `Closes #123`,
`BREAKING CHANGE:`) carry facts the PR must repeat.

### The diff

```bash
git diff --stat <remote>/<base>...HEAD
git diff <remote>/<base>...HEAD -- <interesting paths>
```

Three dots, not two: compare against the merge base, so commits landed on
the base since branching do not show up as part of this branch's work.

The stat answers "what area of the codebase is this?" — which is the input
to the scope, and the fastest way to notice that a branch does two
unrelated things.

### Planned-work documents

Repositories record intended work in wildly different ways: a directory of
specs, proposals, RFCs, change entries, or design docs; a numbered ADR
folder; an issue template checked into `.github/`; a task list in the
README. There is no single layout to assume, and no particular tool to
expect.

Find whichever exists, rather than guessing:

```bash
# Docs the branch itself touched
git diff --name-only <remote>/<base>...HEAD

# Docs it added
git log --diff-filter=A --name-only <remote>/<base>..HEAD
```

A spec that the branch added or modified is the strongest signal available
— stronger than the commits, because it was written before the work and
usually states the intent. Failing that, search by the vocabulary the
branch and its commits use.

Use the `Grep` tool for that — the key terms from the branch name and its
commit subjects, across `*.md`, case-insensitively, listing the files that
match — then read the candidates. Also check the conventional homes of such
documents, where they exist: `docs/`, `specs/`, `rfcs/`, `adr/`,
`changes/`, `proposals/`, `.github/`.

When a matching document exists, read it and use its problem statement and
acceptance criteria — but summarise. A PR description is not the place to
paste a spec; link to the file path and pull out what a reviewer needs.

### The linked issue

Issue references in commit messages or the branch name (`#123`,
`ABC-412`) identify the work item. Fetch it and use its title and body as
context — and repeat its number in the description; GitHub, GitLab, and
similar hosts all auto-link an issue reference by number.

**Never invent one.** An issue number that appears nowhere in the commits,
the branch name, the repo, or the user's instruction does not go in the
description.

## 2. Derive the title

Format: `<type>[optional scope][!]: <description>` — Conventional Commits
v1.0.0. When the `conventional-commits` skill is available, hand the
decided change to it and use what it returns; it owns the full type
vocabulary and formatting rules.

Deriving from a whole branch rather than a single change:

- **One commit** — its subject, verbatim, unless it reads as
  work-in-progress (`wip`, `fixup!`, `address review`).
- **One feature plus its tests and docs** — the feature's type and
  description. The `test` and `docs` commits are supporting work, not
  separate headline changes.
- **Several fixes in one area** — `fix(<area>): <what is now correct>`;
  describe the outcome, not the count.
- **A refactor plus a behaviour change** — title the behaviour change. If
  the two are genuinely independent, say so and suggest splitting the
  branch.
- **Any commit with `!` or `BREAKING CHANGE:`** — the same type, with `!`,
  and a `BREAKING CHANGE:` paragraph in the body.

Rules that hold regardless of shape:

- **Scope** only when every commit shares one. A branch touching three
  packages has no scope; forcing one misleads.
- **Imperative mood, lowercase, no trailing period** — `add`, not `added`
  or `Adds`.
- **Describe the outcome, not the mechanics.** `fix(auth): reject expired
refresh tokens` beats `fix(auth): update token check in middleware`.
- **Fit in ~72 characters.** Detail belongs in the body.
- A branch name is a hint, never the title. It is often stale and always
  abbreviated.

## 3. Write the description

This repository's template is fixed — reuse every heading, in this order.
Leave a section's body as `N/A` (or, for **Screenshots** and **Breaking
changes**, drop the heading entirely) rather than inventing content to
fill it; an empty heading is still worse than an absent one, but a
renamed or reordered one breaks the template for the next reader.

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

Check off a `Test plan` or `Checklist` box only for something actually
done — do not tick a box to make the PR look more complete than it is.
Leave it unchecked and say why (or note the gap inline) when a step
wasn't run.

Close with whatever attribution footer the session's own guidance
requires, if any.

Style: prose in the summary, bullets everywhere else. State what is true —
no "this PR aims to" hedging, and no claiming a test ran or a box was
checked that wasn't.

## Worked example

Branch `feat/webhook-retries`, three commits, cut from `main`:

```text
feat(webhooks): retry failed deliveries with exponential backoff
test(webhooks): cover retry exhaustion and jitter bounds
docs(webhooks): document the retry policy and its limits
```

The branch also modified `docs/design/webhook-delivery.md`, which states
that deliveries currently fail permanently on a single 5xx, and that the
retry budget must be capped at five attempts over roughly 15 minutes.
Commit one carries `Closes #418`.

**Title** — one headline change with its tests and docs alongside; one
shared scope; no breaking marker:

```text
feat(webhooks): retry failed deliveries with exponential backoff
```

**Description**:

```markdown
## Summary

A webhook delivery that hit a 5xx was dropped permanently, so a few
seconds of receiver downtime meant silently lost events. Failed deliveries
are now retried with exponential backoff and jitter, capped at five
attempts over ~15 minutes.

## Changes

- Retry failed deliveries on 5xx and on connection errors; 4xx responses
  stay terminal, since retrying them cannot help.
- Cap the retry budget at 5 attempts with full jitter, per the policy in
  `docs/design/webhook-delivery.md`.
- Record attempt count and next-attempt time on the delivery record so
  exhausted deliveries are visible rather than merely absent.

## Motivation

Closes #418. Policy and the reasoning behind the cap:
`docs/design/webhook-delivery.md`.

Retrying 4xx was considered and dropped — a rejected payload is rejected
identically on every attempt, and retrying only multiplies receiver load.

## Test plan

- [x] Unit/integration tests: `pnpm test --filter webhooks` — covers
      backoff bounds, jitter, and retry exhaustion
- [ ] E2E: none yet, gap noted below
- [x] Manual: verified against a receiver returning 503 for 90 seconds
  1. Trigger a delivery against the stub receiver
  2. Force five consecutive 503 responses
  3. Expected result: the delivery succeeds on attempt four
- [x] Edge cases exercised: retry exhaustion (all five attempts fail),
      jitter bounds
- [ ] Not verified in a staging environment — low-risk, internal-only path

## Checklist

- [x] Tests added/updated, and they fail on `main` without this change
- [x] Rollback is safe (revert, no data migration to undo)
- [ ] Logs/metrics/alerts updated — gap: attempt count isn't surfaced to
      the existing delivery dashboard yet, tracked in #419
- [x] Docs updated (`docs/design/webhook-delivery.md`)
- [x] No secrets, debug code, or commented-out blocks left in
- [x] No breaking changes
```
