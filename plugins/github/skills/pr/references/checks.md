# Watching checks and resolving failures

## What to watch

A push triggers whatever the repository configures: GitHub Actions
workflows, external CI reporting commit statuses, or nothing at all. Watch
the checks attached to the **head SHA** (`git rev-parse HEAD`), not to the
branch name — a branch that was just pushed to has runs from the previous
SHA still finishing, and reporting those is how a red PR gets called green.

Two independent things gate a merge, and both need checking:

- **Check conclusions** — every required check has finished and passed.
- **Mergeability** — no conflict with the base. A conflict blocks the
  merge with every check green.

## MCP tools

Exact tool names depend on which toolsets the GitHub MCP server has
enabled. List the available `mcp__github__*` tools once at the start of a
run rather than assuming. The ones typically present:

| Purpose                        | Tool                                   |
| ------------------------------ | -------------------------------------- |
| PR state, mergeability         | `get_pull_request`                     |
| Rolled-up check state for a PR | `get_pull_request_status`              |
| Runs for a branch or SHA       | `list_workflow_runs`                   |
| One run's detail               | `get_workflow_run`                     |
| Jobs within a run              | `list_workflow_jobs`                   |
| Logs of failing jobs           | `get_job_logs` (filter to failed jobs) |
| Re-run only what failed        | `rerun_failed_jobs`                    |

Prefer `get_job_logs` filtered to failures over whole-run logs. A full
Actions log is mostly setup noise and will crowd out everything else.

## `gh` equivalents

Used when the MCP server is unavailable or unauthenticated.

```bash
# Rolled-up checks for the PR, one line each
gh pr checks <number>

# PR state, per-check detail, and conflict status in one call
gh pr view <number> --json state,mergeable,mergeStateStatus,statusCheckRollup

# Runs for this branch, with their head SHA so stale runs can be dropped
gh run list --branch <branch> \
  --json databaseId,name,status,conclusion,headSha,createdAt

# Failing steps only
gh run view <run-id> --log-failed

# Re-run just the failed jobs
gh run rerun <run-id> --failed
```

`gh pr checks --watch` blocks until every check completes, which is
convenient and also a good way to exceed a command timeout on a slow
suite. Prefer repeated non-blocking calls; keep `--watch` for suites known
to be short, and always give it a bounded timeout.

Exit codes from `gh pr checks`: `0` all passed, `8` still pending, `1`
something failed. Check the code — parsing the human-readable output for
the word "fail" is fragile.

## Polling

- Wait ~10 seconds after a push before the first look; runs take a moment
  to register. "No runs found" one second after a push means nothing.
- Poll about every 30 seconds while runs are in progress; stretch the
  interval for suites that historically run long.
- Report each check as it resolves rather than saving everything for the
  end — a failure at minute two is worth surfacing at minute two.
- Cap the total wait (~30 minutes is generous for most repositories).
  On timeout, report what is still pending and hand back rather than
  polling indefinitely.
- A required check that never appears is a configuration problem, not a
  slow run. Say so instead of waiting it out.

## Failure taxonomy

Classify before fixing. The wrong classification wastes an iteration of a
budget that only has three.

- **Code** — a test assertion, compiler, type, or lint error naming
  repository files. Reproduce locally, fix, confirm, push.
- **Config** — workflow YAML error, missing action input, bad matrix. Same
  handling, but the fix lives in `.github/workflows/`.
- **Access** — missing secret or credential, permission denied on a token.
  Not fixable from here: report exactly which secret or permission is
  missing, and stop.
- **Infrastructure** — runner outage, network timeout, registry 5xx,
  cancelled job. Offer a re-run of the failed jobs; no code change.
- **Flake** — passes locally, fails intermittently, timing- or
  order-dependent. Re-run once to confirm. If it passes, say plainly that
  a flake was re-run rather than fixed, and point at the test.
- **Human** — required review, CODEOWNERS approval, policy gate. Nothing
  to fix; report who or what is being waited on.
- **Conflict** — the branch no longer merges cleanly into the base. Rebase
  or merge the base in, with confirmation, then re-push.

Re-running is cheap; a speculative "fix" for a failure that was never in
the code is expensive and pollutes the branch history. When the logs do
not clearly implicate the repository's own code, re-run before editing
anything.

## The fix loop

Three iterations, maximum. Track them explicitly and say which one is in
progress.

Per iteration:

1. Fetch the failing jobs' logs.
2. Classify per the table above.
3. For a code or config failure, reproduce locally where the repository
   makes that possible — the workflow file names the commands it runs.
   A fix verified locally is worth far more than one pushed on a hunch.
4. Fix **only** what the check flagged. Unrelated problems noticed along
   the way get mentioned, not committed.
5. Show the diff and the proposed Conventional Commits message. Wait for
   an explicit yes. Then commit and push to the same branch.
6. Re-resolve the head SHA and watch again.

Pushing to the branch re-triggers the checks and updates the same pull
request — that is the resubmission. Never open a second PR for the same
branch.

Stop early, without spending the remaining budget, when:

- The same check fails the same way twice after a fix aimed at it — the
  diagnosis is wrong, and a third guess will not improve it.
- The failure is **Access** or **Human** class.
- A fix would require a decision the user has not delegated: changing a
  test's expectations, relaxing a lint rule, disabling a check, bumping a
  dependency major.

On stopping, report: each iteration attempted, what was changed, what the
check said afterwards, and the most probable remaining cause. A precise
handoff beats an exhausted budget.

## Honesty rules

- Read conclusions before reporting them. Never infer green from a push
  that "should" pass.
- "No checks are configured" and "all checks passed" are different
  outcomes. Say which.
- A re-run that turns a job green is a re-run, not a fix. Report it that
  way; a flake that was papered over is a flake that comes back.
- A skipped or neutral check is neither a pass nor a failure. Name it and
  say whether it is required.
