# Agent Instructions

Instructions for AI coding agents (Claude Code, etc.) working in this repository.

## Package manager

This repository uses **pnpm**. Do not use `npm` or `yarn` for repository
tooling — the one exception is plugin dependency lockfiles, described
below.

- Install dependencies: `pnpm install`
- Add a dependency: `pnpm add <package>`
- Add a dev dependency: `pnpm add -D <package>`
- Run a script: `pnpm run <script>` (or `pnpm <script>`)

Never run `npm install`, `npm add`, `yarn`, or commit a `package-lock.json`
/ `yarn.lock` **at the repository root**. Only `pnpm-lock.yaml` belongs
there.

### Exception: plugin roots need an npm lockfile

A directory under `plugins/` that declares runtime `dependencies` must
commit a **`package-lock.json`** alongside its `package.json`, generated
with `npm install --package-lock-only` run inside that plugin directory.

This is not a style preference. When Claude Code copies a plugin into its
cache — on install, on update, and at session start when an enabled plugin
isn't cached yet — it installs that plugin's dependencies, but only when it
finds a lockfile it trusts:

- `bun.lock` / `bun.lockb` →
  `bun install --frozen-lockfile --ignore-scripts`
- `npm-shrinkwrap.json` / `package-lock.json` → `npm ci --ignore-scripts`
- `pnpm-lock.yaml` / `yarn.lock` → **nothing, the install is skipped**

pnpm and Yarn are skipped because both support resolution-time
configuration hooks that can bypass `--ignore-scripts`. A plugin with a
`package.json` and no usable lockfile is skipped silently, so its hooks
would fail at runtime with an unresolvable `require`.

Two constraints follow, and both are load-bearing:

- **Zero transitive dependencies, no build step.** The install is capped at
  60 seconds and runs with `--ignore-scripts`, so anything needing a
  `postinstall` compile will not work.
- **Pin an already-published version.** `npm ci` fails rather than
  re-resolving when `package.json` and the lockfile disagree, so the shared
  package must be released to npm before a plugin can pin it.

The repository itself is still pnpm-only: `pnpm install` at the root,
`pnpm-lock.yaml` as the root lockfile, and `packages/*` as the only pnpm
workspace. `plugins/*` is deliberately **not** a workspace member — linking
a plugin to local package source would let its tests pass against code that
installed users never receive.

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

[`terraform/rulesets.tf`](terraform/rulesets.tf) is the source of truth for
these rulesets' configuration — edit it via a PR rather than the GitHub UI.

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
