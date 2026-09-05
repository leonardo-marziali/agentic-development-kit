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
context — and repeat its number in the description so GitHub links them.

**Never invent one.** An issue number that appears nowhere in the commits,
the branch name, the repo, or the user's instruction does not go in the
description.

## 2. Derive the title

Format: `<type>[optional scope][!]: <description>` — Conventional Commits
v1.0.0. When the `git` plugin's `conventional-commits` skill is available,
hand the decided change to it and use what it returns; it owns the full
type vocabulary and formatting rules.

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

Include only the sections that have real content. An empty heading is
worse than an absent one.

```markdown
## Summary

One or two sentences: what changes and why it is needed. Written for a
reviewer who has not read the branch.

## Changes

- The substantive changes, one bullet each, grouped by area.
- Behaviour first, mechanics second. Skip pure noise (formatting,
  generated files) unless a reviewer needs to know it is there.

## Context

Links: `Closes #123`, the spec or design doc by repository path, related
PRs. Also the decisions a reviewer would otherwise ask about — an approach
considered and rejected, a constraint that forced an odd shape.

## Verification

How the change was checked: the test suites run, what was added, anything
verified manually, and anything deliberately not covered.

## Breaking changes

Only when there are any: what breaks, and what a consumer must do about
it. Mirror the `BREAKING CHANGE:` footer from the commit.
```

Close with whatever attribution footer the session's own guidance
requires, if any.

Style: prose in the summary, bullets everywhere else. State what is true —
no "this PR aims to" hedging, and no claiming a test ran that did not.

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

## Context

Closes #418. Policy and the reasoning behind the cap:
`docs/design/webhook-delivery.md`.

Retrying 4xx was considered and dropped — a rejected payload is rejected
identically on every attempt, and retrying only multiplies receiver load.

## Verification

`pnpm test --filter webhooks` covers backoff bounds, jitter, and retry
exhaustion. Manually verified against a receiver returning 503 for 90
seconds: the delivery succeeded on attempt four.
```
