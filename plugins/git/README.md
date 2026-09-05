# git

A Claude Code plugin providing git workflow helpers.

## Skills

### `branch` (user-invocable, `/git:branch`)

Creates a git branch with the mechanical safety checks run first, then
creates and switches in a single `git switch -c`.

- Runs the pre-creation preflight: working tree state, base branch
  resolution (never assumes `main` — checks the remote default, a Git Flow
  `develop`, or a feature branch to stack on), base freshness via
  `git fetch`, and a local **and** remote name-collision check.
- **Stops and asks if the working tree is dirty** — carry the changes over,
  commit them first, stash, or discard — rather than guessing.
- Names the branch from the project's convention, read from
  `CLAUDE.md`/`AGENT.md`/`CONTRIBUTING.md`/`.github/` or inferred from
  existing branch names, falling back to GitHub flow
  (`<type>/<short-description>`). Never invents a ticket ID. The naming
  rules, type vocabulary, and worked examples live in
  `skills/branch/references/naming.md`.
- **Never rewrites history.** Work already committed on the base branch is
  out of scope.
- **Pushes only on explicit confirmation** (`git push -u origin <name>`).
  `git fetch` and `git ls-remote` are the only remote calls it makes
  unprompted, and both are read-only.

### `commit` (user-invocable, `/commit`)

Stages changes and creates [Conventional
Commits](https://www.conventionalcommits.org/) commits, splitting unrelated
changes into separate commits by functional affinity.

- Scopes changes from explicit file paths, a natural-language description,
  or everything modified/untracked.
- Groups changed files into logically separate commits.
- Delegates message wording to the `conventional-commits` skill below.
- **Always asks for explicit confirmation of the commit message before
  running `git commit`.**
- Never pushes to a remote.

### `conventional-commits` (auto-triggered, not a slash command)

Generates a single commit message that complies with the [Conventional
Commits v1.0.0 specification](https://www.conventionalcommits.org/en/v1.0.0/)
— type, optional scope, optional breaking-change marker, description, body,
and footers — given a diff or description of one already-decided change. It
only produces message text; it never stages files or runs `git commit`
itself. The `commit` skill calls into it for every message it proposes, and
it also triggers standalone whenever the task is specifically about
wording/formatting a commit message (e.g. "write a conventional commit
message for this diff"). The full spec text lives in
`skills/conventional-commits/references/specification.md`.

## Usage

```text
/git:branch
/git:branch feat/oauth-login
/git:branch add rate limiting to the webhook endpoint
/git:branch ABC-412

/commit
/commit src/foo.ts src/bar.ts
/commit all the files related to authentication
```

`branch` and `commit` are also invoked by Claude on its own when a branch or
a commit is needed mid-task; `conventional-commits` only ever triggers
automatically.

## Installation

Install locally for testing:

```bash
cc --plugin-dir /path/to/plugins/git
```
