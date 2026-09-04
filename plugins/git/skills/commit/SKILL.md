---
name: commit
description: This skill should be used when the user asks to "commit", "commit these changes", "create a commit", "stage and commit", or "/commit", and wants one or more git commits created following Conventional Commits. Never pushes to a remote.
argument-hint: '[file paths...] | [natural-language description of files to include]'
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git add:*), Bash(git commit:*), Bash(git log:*), Bash(git show:*), Read, Grep, Glob
---

# Commit

Create one or more git commits following Conventional Commits, splitting
unrelated changes into separate commits by functional affinity. Arguments
given, if any: `$ARGUMENTS`

## 1. Figure out the scope

Run `git status` and `git diff` (unstaged) first to see the full picture
of what's changed.

- **No arguments**: the scope is everything modified/untracked.
- **One or more literal file paths**: the scope is exactly those paths
  (verify each exists in `git status` output first; if one doesn't match
  anything, say so instead of silently skipping it).
- **A natural-language description** (e.g. "all the js files", "the files
  related to authentication"): interpret it against `git status`/`git diff`
  output, reading file contents/diffs as needed to judge relevance. The
  scope is only the files that match.

**If the natural-language match is ambiguous** — nothing clearly matches,
or there are multiple plausible interpretations — do NOT guess. List the
candidate files with a one-line reason each and ask for confirmation
before staging or committing anything.

Never touch files outside the scope (no scooping up unrelated changes
when specific files or a specific description were given).

## 2. Group the scope into logical commits

Read the diffs (and file contents where needed) for everything in scope,
then group the files by functional affinity — files that belong to the
same concern, feature, or area go in one group; unrelated concerns go
in separate groups. Judge affinity by what the change is _for_, not
just by directory:

- Config/tooling for a specific feature (e.g. a markdown-linting plugin
  and its config) is its own group, separate from general repo
  scaffolding (e.g. root editor/git/package config) even if both landed
  in the same commit of upstream history.
- Files that only make sense together (e.g. a plugin manifest and the
  code it points to) stay in one group.
- Docs that describe a specific change ship with that change;
  general/unrelated doc updates get their own group.

Each group becomes one commit, committed in an order where earlier
commits don't depend on later ones being present (e.g. foundational
config before things that build on it).

**If a natural-language description or explicit file list was given,
respect it as an outer boundary** — group only within that scope,
don't pull in extra files to "complete" a group.

If everything in scope is genuinely one cohesive change (e.g. a small
fix touching a few related files), it's fine to end up with a single
group/commit — don't force a split that doesn't reflect real functional
boundaries.

**Before staging anything**, show the proposed groups (files + one-line
rationale each) and the commit message planned for each, so the split
can be confirmed or adjusted.

## 3. For each group, stage → verify → confirm → commit

Repeat for each group, in order:

1. Stage exactly that group's files (`git add <paths>`), nothing more.
2. Run `git diff --staged` and read it in full — the commit message must
   be based on what this diff actually does, not a generic description
   of the files touched.
3. Write the commit message for this diff using the `conventional-commits`
   skill (in this same plugin) — it holds the full Conventional Commits
   v1.0.0 grammar and the reasoning for picking a type/scope/breaking-change
   marker; don't re-derive those rules here. The target repo may enforce
   them via a commitlint `commit-msg` hook — malformed messages will be
   rejected, so get the formatting right before proposing it.

4. **Show the exact commit message to the user and wait for explicit
   confirmation before running `git commit`.** Present it verbatim,
   e.g.:

   ```text
   About to commit with this message:

   ---
   <type>(<scope>): <description>

   [optional body]
   ---

   Proceed?
   ```

   - If the user asks for changes, revise the message and confirm again
     before committing.
   - Do not batch confirmation across groups — confirm each commit
     message individually, immediately before creating that commit.

5. Once confirmed, run `git commit -m "..."` (use a proper multi-line
   message, e.g. via a heredoc or multiple `-m` flags, when there's a
   body). Do not use `--no-verify`.

   If the commit is rejected by a commitlint hook, read the error, fix
   the message, confirm the revised message with the user again, and
   retry — don't bypass the hook. Allow at most 2 retry attempts for this
   group (3 `git commit` attempts total). If it's still being rejected
   after that, stop, show the user the exact commitlint error from the
   last attempt plus the message that produced it, and ask how to
   proceed rather than continuing to guess.

**Never run `git push`, or any other command that touches a remote.**
This skill only commits locally.

## 4. Report back

Show, for each commit created:

- The files staged/committed (`git show --stat -1` or similar).
- The commit itself (hash + message).

so the full result can be confirmed at a glance.
