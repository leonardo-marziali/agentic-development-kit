# agentic-development-kit

[![coverage](https://codecov.io/gh/leonardo-marziali/agentic-development-kit/branch/main/graph/badge.svg)](https://codecov.io/gh/leonardo-marziali/agentic-development-kit)

An opinionated hosted collection of skills, plugins, agent definitions, and configs
for agentic development with [Claude Code](https://claude.com/claude-code)

## Plugins

Add this repository as a [plugin marketplace](.claude-plugin/marketplace.json):
inside Claude Code, then install a plugin from it (for example `markdown`):

```text
/plugin marketplace add leonardo-marziali/agentic-development-kit
/plugin install markdown@agentic-development-kit
```

## Repository structure

```text
.claude-plugin/marketplace.json   Marketplace manifest listing available plugins
.claude/commands/                 Repo-local Claude Code slash commands
.claude/hooks/                    This repo's own development hooks (not shipped)
plugins/                          Individual plugins hosted by this marketplace
  markdown/                       Authoring/linting skills, LSP config, and hooks
  prettier/                       Format-on-edit hook and a manual formatting skill
  git/                            Safety-checked branching and Conventional Commits
  github/                         Pull request lifecycle: open, watch checks, merge
  java/                           Reserved for a future Java plugin
```

Each plugin under `plugins/` is self-contained with its own `plugin.json`,
`skills/`, `hooks/`, and (where relevant) tests. See
[plugins/markdown/README.md](plugins/markdown/README.md) for an example of a
fully documented plugin.

`.claude/hooks/` is deliberately **not** part of any plugin: those hooks
enforce that a change to a plugin's hook source in this repo can't finish a
session without that plugin's test suite having been run against it. They
apply to anyone working in this repository, and ship to nobody who installs
a plugin from it.

Not yet present, but planned for this repo:

- **Agent definitions** — reusable Claude Code agent configurations for
  recurring roles/workflows.
- **Devcontainer image** — a container image that ships this repository's
  plugins and configs preinstalled, for a ready-to-go agentic dev
  environment.

## Development

### Dependencies

To work on this repository (root-level tooling: commit linting, Husky
hooks, markdown linting) you need:

- **[Node.js](https://nodejs.org/)** — v24.20.0 or later
- **[pnpm](https://pnpm.io/)** — the only supported package manager for this repo.
  Do not use `npm` or `yarn`.
- **Git** — with commit hooks enabled (installed automatically by `pnpm
install`, see below).

The exact Node.js and pnpm versions are pinned in [`mise.toml`](mise.toml)
and mirrored in `package.json`'s `engines`/`packageManager` fields. Install
[mise](https://mise.jdx.dev) and run `mise install` before working on this
repo — it activates the pinned Node/pnpm versions automatically so your
local toolchain matches CI.

Root `devDependencies` (installed via `pnpm install`):

- [`husky`](https://typicode.github.io/husky/) — manages the Git
  `commit-msg` hook.
- [`@commitlint/cli`](https://commitlint.js.org/) and
  [`@commitlint/config-conventional`](https://commitlint.js.org/) — enforce
  [Conventional Commits](https://www.conventionalcommits.org/) on every
  commit message.

Additional tooling used but not installed as an npm dependency:

- [`markdownlint-cli`](https://github.com/igorshubovych/markdownlint-cli) —
  invoked on demand via `npx` (see `.markdownlint.jsonc` for the root
  config); no separate install step is required, but it needs network
  access (or a warm `npx` cache) the first time it runs.
- [`marksman`](https://github.com/artempyanykh/marksman) — markdown
  language server used by the `markdown` plugin's editor integration.
  Install it separately, e.g. `brew install marksman`. Only needed if you
  use that plugin's LSP features.

### Setup

```bash
pnpm install
```

This installs the root `devDependencies` and runs the `prepare` script,
which sets up Husky's Git hooks (including `commit-msg` commit linting).

### Commits

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/),
enforced by `commitlint` via a Husky `commit-msg` hook — commits that don't
match the format are rejected locally.

### Testing

Each suite runs independently, with Node's built-in test runner:

```bash
pnpm test
cd plugins/markdown && pnpm test
cd plugins/prettier && pnpm test
```

The root `pnpm test` covers this repo's own hooks in `.claude/hooks/` and the
scripts in `scripts/`. See a plugin's own README
([markdown](plugins/markdown/README.md),
[prettier](plugins/prettier/README.md)) for what its suite covers.

### Coverage & CI

A single [`plugin-tests.yml`](.github/workflows/plugin-tests.yml) workflow
runs whichever suites are affected by a given pull request (via
`dorny/paths-filter`, so an unrelated plugin's suite doesn't run on every
change) and uploads each one's coverage to
[Codecov](https://codecov.io/gh/leonardo-marziali/agentic-development-kit)
under its own flag (`repo-root`, `markdown-plugin`, `prettier-plugin`).
[`codecov.yml`](codecov.yml) carries each flag's last-known coverage forward
on commits that don't re-upload it, so the badge above — the combined
coverage across every flag — stays accurate even though the suites upload
independently.

It only triggers on `pull_request`, not on `push` to `main`: see "Branch
protection" below for why a push to `main` never needs its own test run.
Because the `test` job runs as a dynamic matrix, its check name isn't
stable across PRs (it depends on which suites are affected) — the
`required` job exists solely to give the branch ruleset one constant
check name to require, regardless of which suites actually ran.

### Branch protection

`main` is a protected branch — it can only be updated by merging a pull
request (no direct pushes, enforced both by a repository ruleset on GitHub
and, locally, by the `pre-push` Husky hook). Every commit that ever reaches
`main` has therefore already been validated by `plugin-tests.yml` on its
pull request; re-running that workflow on the resulting push to `main`
would just repeat the same result against the same tree, so it's skipped.

Both of `main`'s branch-protection rulesets are managed via Terraform in
[`terraform/`](terraform/), backed by HCP Terraform (Terraform Cloud) for
state. [`terraform-plan.yml`](.github/workflows/terraform-plan.yml) plans
changes on pull requests touching `terraform/**`, and
[`terraform-apply.yml`](.github/workflows/terraform-apply.yml) applies them
automatically on merge to `main`. Ruleset changes should go through a pull
request touching [`terraform/rulesets.tf`](terraform/rulesets.tf), not the
GitHub UI.

Pull requests are merged with the **squash** strategy: a merged PR becomes
a single commit on `main`, titled from the PR title (see "Pull request
titles" below). See [CONTRIBUTING.md](CONTRIBUTING.md) for the full
git workflow — branching, commits, the PR description template, and
merging.

### Pull request titles

[`pr-title.yml`](.github/workflows/pr-title.yml) uses
[`amannn/action-semantic-pull-request`](https://github.com/amannn/action-semantic-pull-request)
to check that a PR's title follows [Conventional
Commits](https://www.conventionalcommits.org/), using the same type
vocabulary as `commitlint.config.js`. This matters because the `github`
plugin's `pr` skill and semantic-release's release notes are both driven
off of that title/history, so a PR titled e.g. `feat: add dark mode` (not
`Add dark mode`) is required before merging.

### Releases & versioning

Every push to `main` (i.e. every merged pull request) runs
[`release.yml`](.github/workflows/release.yml), which invokes
[semantic-release](https://semantic-release.org/) (config in
[`release.config.js`](release.config.js)). It inspects the Conventional
Commit messages introduced since the last release to decide whether the
next version is a major/minor/patch bump, then creates a git tag
(`vX.Y.Z`) and a GitHub Release with generated notes — no maintainer ever
picks a version number by hand.

It also generates a `CHANGELOG.md` at the repo root (via
`@semantic-release/changelog`) and commits it back to `main` (via
`@semantic-release/git`) as part of the same release — so release history
travels with the source, not just GitHub's Releases page.

This repo is a private plugin marketplace, not something published to the
npm registry, so there's deliberately no `@semantic-release/npm` (nothing
to publish) — `package.json`'s `version` field stays `0.0.0` and the git
tag is the source of truth for the released version. Pushing
`CHANGELOG.md` back to `main` from CI needs a bypass entry, for the
release workflow's actor, on the branch-protection ruleset described in
"Branch protection" above — that ruleset otherwise blocks any push that
isn't a pull request merge, the same way it blocks a direct push from a
human. To pin to a specific release, reference its tag instead of a
branch when adding the marketplace, e.g.:

```text
/plugin marketplace add leonardo-marziali/agentic-development-kit@v1.4.0
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the git workflow — branching,
commits, opening a pull request, the description template, and merging.
Coding agents should read [AGENT.md](AGENT.md) instead, which covers the
same workflow with agent-specific detail.

## License

[MIT](LICENSE)
