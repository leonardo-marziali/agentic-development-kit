# Agent Instructions

Instructions for AI coding agents (Claude Code, etc.) working in this repository.

## Package manager

This repository uses **pnpm** exclusively. Do not use `npm` or `yarn`.

- Install dependencies: `pnpm install`
- Add a dependency: `pnpm add <package>`
- Add a dev dependency: `pnpm add -D <package>`
- Run a script: `pnpm run <script>` (or `pnpm <script>`)

Never run `npm install`, `npm add`, `yarn`, or commit a `package-lock.json`
/ `yarn.lock`. Only `pnpm-lock.yaml` should be committed as the lockfile.

## Plugin skill naming

Prefix a skill's `name` with the most specific subject it documents, not
mechanically with the owning plugin's name:

- Skills about the plugin's general domain use that domain as the prefix
  (e.g. `markdown-tables` in the `markdown` plugin).
- Skills about a specific tool within the plugin use that tool's name
  instead (e.g. `markdownlint-configuration`, `marksman-lsp-usage`) — the
  tool name disambiguates better than the plugin name when skills are
  matched from a flat, cross-plugin list.
- User-invocable skills (slash commands) get short verb names with no
  prefix (e.g. `lint`).

## Commits

Commit messages must follow [Conventional Commits][cc] — enforced via
commitlint and a husky `commit-msg` hook.

[cc]: https://www.conventionalcommits.org/

## Branches

Branch names follow GitHub flow:

```text
<type>/<short-description>
```

- `<type>` is one of the commitlint types in use: `build`, `chore`, `ci`,
  `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, `test`.
- `<short-description>` is lowercase kebab-case, 2–5 words, under ~40
  characters total.
- Branch from `main` unless the work explicitly stacks on another branch.

The `git` plugin's `branch` skill reads this section. The human-facing
version of this convention lives in [CONTRIBUTING.md](CONTRIBUTING.md);
keep the two in sync if either changes.

## Branch protection

`main` is protected: no direct or force pushes, enforced both by a GitHub
repository ruleset and by a local `pre-push` Husky hook. Every change
reaches `main` only by opening a pull request — never push directly to
`main` and never suggest `--no-verify` or `-f` as a way around a blocked
push. If a push to `main` is rejected, that is working as intended: branch
off, commit there, and open a PR instead.

## Pull requests

Open pull requests with the `github` plugin's `pr` skill where available —
it derives the title and description from the branch, watches CI, and
handles the fix/re-push loop. Two rules apply regardless of how a PR is
opened:

- **Title** must be a valid Conventional Commit
  (`<type>[optional scope][!]: <description>`) — `pr-title.yml` enforces
  this, and the title becomes the squashed commit message on `main` (see
  below), which drives semantic-release's version bump.
- **Description** must follow the template in
  [CONTRIBUTING.md](CONTRIBUTING.md#description-template) — Summary,
  Changes, Motivation, Screenshots (if UI change), Test plan, Checklist,
  Breaking changes. The `git` plugin's
  [`pr-description`](plugins/git/skills/pr-description/SKILL.md) skill
  is the authoritative copy of this template for agents composing a
  description; keep both in sync if either changes. Never check a
  `Test plan` or `Checklist` box for something that wasn't actually done.

## Merging

This repository's merge strategy is **squash**: a merged PR becomes one
commit on `main`, titled from the PR title. Do not merge a PR yourself
unless the user has explicitly asked for it — the `pr` skill asks before
merging, and any other merge path (`gh pr merge`, the GitHub UI) needs the
same confirmation first.
