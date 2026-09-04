# git

A Claude Code plugin providing git workflow helpers.

## Skills

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
/commit
/commit src/foo.ts src/bar.ts
/commit all the files related to authentication
```

## Installation

Install locally for testing:

```bash
cc --plugin-dir /path/to/plugins/git
```
