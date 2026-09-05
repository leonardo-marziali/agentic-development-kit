---
name: pr
description: This skill should be used when the user asks to "open a PR", "create a pull request", "raise a PR for this branch", "PR this", "open the PR and watch CI", "fix the failing checks on my PR", "is my PR green?", "merge my PR", or "/github:pr". Opens (or updates) the pull request for the current branch with a Conventional Commits title and a description derived from the branch's commits, specs, and docs; then waits for the triggered checks, diagnoses failures, pushes confirmed fixes, re-runs the cycle, and asks before merging.
argument-hint: '[title or summary] | [base <branch>] | [--draft]'
allowed-tools: mcp__github, Bash(git status:*), Bash(git branch:*), Bash(git log:*), Bash(git diff:*), Bash(git fetch:*), Bash(git rev-parse:*), Bash(git rev-list:*), Bash(git symbolic-ref:*), Bash(git remote:*), Bash(git ls-remote:*), Bash(git switch:*), Bash(git pull:*), Bash(git push:*), Bash(git add:*), Bash(git commit:*), Bash(git rebase:*), Bash(git merge:*), Bash(git config:*), Bash(gh pr:*), Bash(gh run:*), Bash(gh repo:*), Bash(gh api:*), Bash(gh auth status:*), Read, Grep, Glob, Edit, Write
---

# Pull Request

Take the current branch from "pushed" to "merged": open the pull request,
name and describe it from what the branch actually contains, watch every
check it triggers, fix what fails, and hand the merge decision back to the
user. Arguments given, if any: `$ARGUMENTS`

Three things this skill never does on its own: create or update a pull
request without showing the title and body first, push a fix without
confirmation, or merge without being asked to.

## 1. Pick the interface

This plugin depends on the official `github` plugin, which supplies the
GitHub MCP server. Prefer its tools (`mcp__github__*`) for everything that
touches GitHub.

Check availability before the first call. That server authenticates with
`GITHUB_PERSONAL_ACCESS_TOKEN`; when it is missing the tools are absent or
every call fails with an auth error. In that case fall back to the `gh`
CLI, after confirming `gh auth status` succeeds.

With neither available, stop and report exactly what is missing — the
dependency not installed/enabled, the token not set, or `gh` not
authenticated. Do not guess at the repository state through some third
path.

State which interface is in use in the first status message, and keep it
for the whole run so the reported results all come from one source. Tool
names written bare below (`create_pull_request`, `get_job_logs`, …) are the
MCP tools `mcp__github__<name>`; the `gh` equivalent follows each one.

## 2. Interpret the arguments, then preflight

Resolve `$ARGUMENTS` first — the base it may name has to be known before
the preflight resolves one:

- `--draft` / `-d` → open the PR as a draft.
- `base <ref>`, or a bare token that resolves to an existing remote branch
  (`git ls-remote --heads origin <token>`) → the base branch.
- Anything else → the title or a summary to build it from.
- Ambiguous between a title and a base (a single word that is also a
  branch name) → ask rather than guess.

Then run these checks before composing anything, and report them as one
short block.

- **Repository and branch** — `git rev-parse --show-toplevel`,
  `git rev-parse --abbrev-ref HEAD`.
- **Base branch** — resolve; never assume `main`. Use
  `git symbolic-ref --short refs/remotes/origin/HEAD`, then a Git Flow
  `develop`, then an explicit base in `$ARGUMENTS`. When the branch was cut
  from another unmerged feature branch, that branch is the base (stacked
  PR) — confirm which is intended.
- **On the base branch already** — stop. There is nothing to open a PR
  from; offer the `git` plugin's `branch` skill to move the work first.
- **Working tree** — `git status --porcelain`. Uncommitted changes mean
  stop and ask: commit them first (hand off to the `git` plugin's `commit`
  skill), or open the PR without them. Never commit them silently.
- **Commits to propose** — `git fetch` then
  `git rev-list --count <remote>/<base>..HEAD`. Zero commits means no PR;
  say so and stop.
- **Upstream** — with no upstream, or with local commits ahead of it, ask
  before `git push -u origin <branch>`. The branch must be pushed before a
  PR can reference it.
- **Existing PR** — look the branch up (`list_pull_requests` filtered by
  head, or `gh pr view --json`). An open PR means this run **updates** it
  and re-enters the check cycle; it never opens a second one.

## 3. Compose the title and description

Gather evidence before writing either. In order of authority: the branch's
commit messages (`git log <remote>/<base>..HEAD`), any spec, proposal, or
change document in the repository describing this work, docs and ADRs
touched by the diff, the linked issue, and finally the diff itself.

Repositories describe planned work in many places and many formats. Search
for it rather than assuming a layout, and treat whatever is found as
supporting evidence, not as text to copy wholesale. `references/pr-content.md`
carries the discovery recipe, the title derivation rules, and the
description template with a worked example.

The title **must** comply with Conventional Commits:
`<type>[optional scope][!]: <description>`. Derive it from the branch as a
whole, not from the last commit:

- One commit on the branch → reuse its subject, unless it is a
  work-in-progress message.
- Several commits → the type of the change the PR delivers, with
  supporting commits (`test`, `docs`, `refactor`) folded under it. A scope
  only when every commit shares one.
- Any commit carrying `!` or a `BREAKING CHANGE:` footer → the title
  carries `!` too.

When the `git` plugin's `conventional-commits` skill is available, use it
for the wording; it owns the type vocabulary and the formatting rules.

Never invent an issue number, ticket ID, or spec name. Reference only what
the commits, the repo, or the user actually provide.

**Show the proposed title and body and get explicit confirmation before
creating or updating the PR.** Apply anything in `$ARGUMENTS` — a supplied
title, a base branch, `--draft` — before asking.

## 4. Open or update the pull request

Create with `create_pull_request` (or `gh pr create`), passing head, base,
title, body, and draft state. Update an existing one with
`update_pull_request` (or `gh pr edit`) — a re-run rewrites the description
only when the branch content has changed since it was written.

On the `gh` path, write the body to a file and pass `--body-file`. A
markdown body containing backticks, `$`, or `#` handed to `--body` through
a shell is a reliable way to lose half the description.

Report the PR number and URL as soon as it exists.

## 5. Watch the checks

A push triggers whatever the repository has configured; there may be none
at all. Resolve the head SHA (`git rev-parse HEAD`) and follow the runs
attached to it until every one has a conclusion.

Poll — do not spin. Leave a beat for runs to register, then check on an
interval of roughly 30 seconds, backing off for long suites, and report
each check as it resolves rather than only at the end. Cap the total wait
(~30 minutes suits most repositories); on timeout, report what is still
pending and hand back instead of polling on. `references/checks.md` has the
tool and `gh` command tables, the polling detail, and the stop-early
conditions for the fix loop.

Also read the PR's mergeability. A conflict with the base blocks the merge
just as a red check does, and is fixed by rebasing or merging the base in —
with confirmation, like any other push.

**Never report the checks as green without having read their conclusions.**
"No runs found" is a distinct outcome from "all runs passed"; say which one
happened.

## 6. Fix what failed

Loop at most **three** times, then stop and hand back a summary of what was
tried and what is still red.

Each iteration:

1. **Read the failure.** Pull the logs of the failing jobs only
   (`get_job_logs` with failures filtered, or `gh run view --log-failed`).
2. **Classify it.** A failure in the repository's own code is fixed by a
   commit. An infrastructure or flake failure — a missing secret, a runner
   outage, a transient network error, a known-flaky test — is not; offer a
   re-run of the failed jobs instead of inventing a code change. The
   taxonomy is in `references/checks.md`.
3. **Fix only what the check flagged.** Reproduce locally where the repo
   makes that possible, and run that same command to verify. No drive-by
   refactors: unrelated cleanup belongs in its own branch.
4. **Confirm, then push.** Show the diff and the proposed Conventional
   Commits message, get an explicit yes, commit, and push to the same
   branch. Pushing re-triggers the checks — that is the resubmission; do
   not open a second PR.
5. **Re-enter section 5** with the new head SHA.

When a failure is not something to fix here — a required reviewer, a
policy check, a genuinely broken pipeline — say so plainly and stop rather
than burning iterations on it.

## 7. Offer the merge

Only once every required check has passed and the PR reports no conflict:
report the green state and **ask whether to merge**. Nothing merges
without an explicit yes.

On a yes, ask which strategy, offering only what the repository actually
allows (read the repo's merge settings — `gh repo view --json
squashMergeAllowed,mergeCommitAllowed,rebaseMergeAllowed` — rather than
listing all three blindly). Recommend squash where allowed: it keeps one
Conventional Commits message per PR on the base branch. For a squash, pass
the PR title as the commit title so the squashed commit stays compliant.

Merge with `merge_pull_request` (or `gh pr merge`), then offer the cleanup
as one step: delete the remote branch, switch to the base, pull, and delete
the local branch.

On a no, leave the PR open and print its URL.

## 8. Report back

Close with: the PR number and URL, its title, the base it targets, the
final state of each check, what was fixed across how many iterations, and
whether it was merged — or exactly what is still blocking it.

## Additional resources

- **`references/pr-content.md`** — finding the branch's specs, docs, and
  issues; deriving a Conventional Commits title from a multi-commit
  branch; the description template and a worked example.
- **`references/checks.md`** — MCP tool and `gh` command tables for runs
  and jobs, polling and timeout guidance, the failure taxonomy, and when
  to re-run instead of re-fix.
