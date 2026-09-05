---
name: branch
description: This skill should be used when the user asks to "create a branch", "new branch", "start a new branch", "branch off", "branch for this", "move this work to a new branch", "put these changes on their own branch", or "/branch" — and whenever a branch must be created before starting new development. Runs the mechanical pre-creation checks (working tree state, correct base branch, base up to date, no local/remote name collision), derives a name from the project's branch naming convention, and creates the branch with a single `git switch -c`. Pushes and sets upstream only after explicit confirmation.
argument-hint: '[branch name] | [natural-language description of the work] | [ticket id]'
allowed-tools: Bash(git status:*), Bash(git branch:*), Bash(git fetch:*), Bash(git pull:*), Bash(git switch:*), Bash(git remote:*), Bash(git ls-remote:*), Bash(git symbolic-ref:*), Bash(git rev-parse:*), Bash(git rev-list:*), Bash(git log:*), Bash(git diff:*), Bash(git config:*), Bash(git check-ref-format:*), Bash(git push:*), Read, Grep, Glob
---

# Branch

Create a git branch safely: run the mechanical pre-creation checks, name it
from the project's convention, and create it in one step. Arguments given, if
any: `$ARGUMENTS`

This skill never rewrites history. Work already committed on the base branch is
out of scope — creating the branch is all this does.

## 1. Establish what the branch is for

Interpret `$ARGUMENTS`:

- **An explicit branch name** — validate it (section 3) and skip derivation.
  Say so if it violates the project's convention, but the user's explicit name
  wins if they confirm it.
- **A natural-language description of the work** — the source for the name.
- **A ticket/issue ID** — use it if the convention has a slot for one.
- **Nothing** — derive intent from the conversation so far and from
  `git status` / `git diff`. A dirty tree means "move this work to its own
  branch" and the name comes from what the diff does; a clean tree means "start
  new work" and the name comes from what was asked for.

**One branch, one concern.** If the uncommitted work (or the described task)
spans two unrelated concerns — a feature plus an unrelated refactor — say so
and ask which one this branch is for, rather than sweeping both onto it.

## 2. Preflight

Run these before proposing anything, and report the findings as one short
block so the state is visible before any ref is created.

### Working tree state

Run `git status --porcelain`. If it is not empty, **stop and ask** — do not
guess. Present the concrete options:

- **Carry the changes onto the new branch** — the usual answer for "move this
  work"; `git switch -c` takes them along.
- **Commit them first** — hand off to the sibling `commit` skill in this
  plugin, then come back.
- **Stash them** (`git stash push -u`) and restore after branching.
- **Discard them** — only on an unambiguous instruction to throw the work away.

Record the answer. It changes which `git switch -c` form section 4 uses.

### Base branch

Do not assume `main`. Resolve, in order:

1. `git symbolic-ref --short refs/remotes/origin/HEAD` — the remote's declared
   default, returned as `<remote>/<base>`.
2. `git branch -a --list '*develop*'` — a `develop` branch signals Git Flow,
   where feature branches cut from `develop`, not `main`.
3. The current branch, when the new work stacks on an unmerged feature branch
   (stacked PRs).

Also check `CLAUDE.md` / `AGENT.md` / `CONTRIBUTING.md` for a stated base. When
more than one candidate is plausible, present them with a one-line reason each
and ask — branching from the wrong base is expensive to undo later.

### Base freshness

Run `git fetch <remote>` — read-only and safe even with a dirty tree. Then
measure the gap:

```bash
git rev-list --count <base>..<remote>/<base>
```

- **Tree clean and the base is checked out** → `git pull --ff-only` to
  fast-forward it, then branch from the local base.
- **Tree clean, on some other branch** → branch directly from
  `<remote>/<base>`; no checkout of the base needed.
- **Carrying uncommitted work** → branch from the current `HEAD`. Do not stash
  and pull behind the user's back. If `HEAD` is behind, say plainly that the
  branch starts from history that is N commits stale and that rebasing onto
  the updated base later is the fix.

### Name collision

Once a candidate name exists, check both:

```bash
git branch -a --list '<name>'
git ls-remote --heads <remote> '<name>'
```

On a hit, propose a genuinely different name — never silently suffix a number.
A collision usually means the work already has a branch; check that first.

### Ticket ID

If the detected convention requires an ID, use only an ID the user supplied or
one verifiable from the repo context (an issue referenced in the conversation,
an existing branch, a linked PR). **Never invent a ticket number.** With none
available, either ask for it or fall back to the ID-less form of the pattern —
and say which was used.

## 3. Derive and validate the name

Detect the project's convention before writing a name:

1. Grep `CLAUDE.md`, `AGENT.md`, `AGENTS.md`, `CONTRIBUTING.md`, and `.github/`
   for a branch-naming rule.
2. Failing that, infer from existing branch names (`git branch -a`) — prefix
   vocabulary, separator, casing.
3. Failing that, use GitHub flow: `<type>/<short-description>`, or
   `<type>/<ticket-id>-<short-description>` when a ticket exists.

A declared convention always beats inference, and inference beats the default.

Consult `references/naming.md` for the type vocabulary, the character and
length rules, the generic-name reject list, and worked examples of deriving a
name from a diff or from a described task.

Validate mechanically before proposing:

```bash
git check-ref-format --branch '<name>'
```

For "move this work", derive the description from what the diff _does_, not
from the filenames it touches.

**Show the proposed name and the resolved base, and get confirmation before
creating anything.** Skip the prompt only when the user supplied an explicit
name that passes validation.

## 4. Create — one step

Create and switch in a single command; never a separate create then checkout.

- **Clean tree** — pass the start point explicitly:

  ```bash
  git switch -c <name> <remote>/<base>
  ```

- **Carrying uncommitted work** — omit the start point:

  ```bash
  git switch -c <name>
  ```

  This branches at `HEAD` and carries the changes over cleanly. Do not pass a
  start point here: moving the work and moving the base in the same command is
  what makes this operation go wrong.

On a git old enough to lack `switch`, `git checkout -b <name> [<start-point>]`
is the equivalent — but default to `switch`.

## 5. Offer upstream tracking

After the branch exists, ask whether to push and set upstream:

```text
Branch created locally. Push it and set upstream now?

  git push -u origin <name>
```

- On an explicit yes, run it.
- On anything else, leave the branch local and print the command.

**Never push without confirmation.** Like the sibling `commit` skill, this
skill does not touch a remote on its own — `git fetch` and `git ls-remote` are
the only exceptions, and both are read-only.

## 6. Report back

Show:

- The branch name and the base it was cut from.
- Whether the base was up to date, and by how many commits if not.
- Whether uncommitted work came along (and what happened to it otherwise).
- Upstream state — tracking set, or the command left for the user.

Then close with the two reminders nothing here can enforce:

- Keep the branch short-lived — the longer it lives, the further it drifts
  from the base and the worse the eventual merge.
- Delete it after merge, locally (`git branch -d <name>`) and on the remote.

## Additional resources

- **`references/naming.md`** — convention detection, the default pattern and
  type vocabulary, character/length rules, the ambiguous-name reject list,
  worked examples, and work-item linkage.
