# github

A Claude Code plugin that drives the GitHub pull request lifecycle: open
the PR, watch what it triggers, fix what breaks, merge when asked.

## Dependencies

This plugin declares dependencies on the official GitHub plugin and on the
local `git` plugin:

```json
"dependencies": ["github@claude-plugins-official", "git"]
```

The official `github` plugin supplies the GitHub MCP server, which is how
this plugin talks to GitHub. Claude Code installs and enables it alongside
this one. The `git` plugin supplies the `pr-description` skill, which
derives the PR title and body — see that plugin's
[README](../git/README.md) for what it does.

The MCP server authenticates with a personal access token, so set it
before use:

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=<token>
```

The token needs `repo` scope (and `workflow` scope to read Actions runs).
Without it, the `pr` skill falls back to the [`gh`
CLI](https://cli.github.com/) when `gh auth status` succeeds, and stops
with a clear message when neither path is available.

## Skills

### `pr` (user-invocable, `/github:pr`)

Opens — or updates — the pull request for the current branch, then follows
it through to merge.

- **Preflight**: resolves the base branch (never assumes `main`), refuses
  to run from the base itself, stops on an uncommitted working tree, and
  pushes the branch only after confirmation. An existing open PR is
  updated, never duplicated.
- **Title**: derived from the branch as a whole — its commits, any spec or
  design document the branch touches, the linked issue, and the diff — and
  always compliant with [Conventional
  Commits](https://www.conventionalcommits.org/). Delegates the wording to
  the `git` plugin's `conventional-commits` skill when that is installed.
  Never invents an issue number or a spec that does not exist.
- **Description**: summary, changes, context (spec and issue links),
  verification, and breaking changes, built from the same evidence. The
  discovery recipe is format-agnostic: it searches for whatever planned-work
  documents the repository actually keeps rather than expecting a
  particular layout or tool.
- **Confirmation before publishing**: the title and body are shown and
  confirmed before any PR is created or updated.
- **Checks**: watches the runs attached to the head SHA until each has a
  conclusion, and reads the PR's mergeability alongside them — a conflict
  blocks a merge just as a red check does.
- **Failure resolution**: classifies each failure (code, config, access,
  infrastructure, flake, human gate, conflict) before acting, re-runs
  flakes instead of inventing fixes for them, reproduces code failures
  locally where possible, and **asks before every push**. Capped at three
  iterations, then hands back a precise summary.
- **Merge**: only after the checks are green and only on an explicit yes.
  Offers the strategies the repository actually allows, keeps the squash
  commit message Conventional Commits-compliant, and offers branch cleanup
  afterwards.

Evidence gathering, title derivation, and the description template live in
the `git` plugin's `pr-description` skill. Reference material specific to
this plugin lives beside the skill: `skills/pr/references/checks.md`
(run/job tooling, polling, failure taxonomy, the fix loop).

## Usage

```text
/github:pr
/github:pr --draft
/github:pr feat(api): add cursor pagination
/github:pr base develop
```

With no arguments, everything is derived from the branch. Arguments
override: an explicit title, a base branch, or draft state.

## Installation

Install locally for testing:

```bash
cc --plugin-dir /path/to/plugins/github
```
