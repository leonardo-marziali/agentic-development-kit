# Versioned CHANGELOG.md via semantic-release

## Problem

Release notes today live only on GitHub's Releases page
(`@semantic-release/github` posts them there). There is no `CHANGELOG.md` in
the repository itself, so anyone reading the source tree — without going to
GitHub — has no record of what changed between versions.

## Goal

Generate a `CHANGELOG.md` at the repo root as part of the existing
semantic-release pipeline, committed to `main` on every release, so release
history travels with the source.

## Constraints carried over from the existing setup

- This repo is a private plugin marketplace, not an npm package:
  `package.json`'s `version` stays `0.0.0` and `@semantic-release/npm` is
  intentionally absent. Nothing in this change alters that.
- `main` is protected by a GitHub ruleset ("Require pull request for default
  branch", ruleset id `22341902`) that blocks any push that isn't a PR merge.
  This is exactly why `@semantic-release/git` was excluded originally (see the
  comment at the top of `release.config.js` before this change).
- A separate, parallel effort is migrating this repo's rulesets into
  Terraform specifically so that ruleset edits — including adding a bypass
  actor — happen as reviewable Terraform diffs. That migration must add a
  bypass entry for the release workflow's actor (the GitHub Actions app /
  `github-actions[bot]`) to ruleset `22341902` before (or together with) this
  change reaches `main`. Until it does, `@semantic-release/git`'s push will be
  rejected by the ruleset and every release run will fail. **This PR must not
  be merged before that sibling Terraform PR merges.** This spec does not
  touch ruleset configuration — that stays entirely in the Terraform effort.
- The existing `HUSKY: 0` env on the `release` job disables Husky hook
  _installation_ in that checkout (`husky`'s `prepare` script no-ops when
  `HUSKY=0`), so neither `commit-msg` nor `pre-push` hooks exist on disk in
  CI. This already covers the new commit `@semantic-release/git` will make —
  no workflow change needed for that.

## Design

### Plugins

Add two plugins to `release.config.js`, in the position semantic-release's
own docs recommend (changelog write happens before git commits it; both run
in the "prepare" step, before `@semantic-release/github` publishes):

```js
plugins: [
  '@semantic-release/commit-analyzer',
  '@semantic-release/release-notes-generator',
  '@semantic-release/changelog',
  '@semantic-release/git',
  '@semantic-release/github',
];
```

- **`@semantic-release/changelog`** — default options. Writes/updates
  `CHANGELOG.md` at the repo root with the same release notes
  `@semantic-release/github` already posts. No custom title or path: the
  default `# Changelog` header and root-level file match this repo's existing
  minimal-config style.
- **`@semantic-release/git`** — `assets: ['CHANGELOG.md']` only. Nothing else
  is versioned by semantic-release in this repo (no `package.json` bump, no
  lockfile change), so there is nothing else to include. The default commit
  message template is kept as-is:

  ```text
  chore(release): ${nextRelease.version} [skip ci]

  ${nextRelease.notes}
  ```

  The `[skip ci]` marker is already part of the plugin's default message —
  no override needed. GitHub Actions natively skips creating a workflow run
  for a push whose commit message contains `[skip ci]`, which prevents this
  commit from re-triggering `release.yml` in a loop.

### Dependencies

Add `@semantic-release/changelog` and `@semantic-release/git` to
`devDependencies` in `package.json`, then `pnpm install` to update
`pnpm-lock.yaml`.

### Workflow (`.github/workflows/release.yml`)

No changes. Considered and rejected: adding `fetch-depth: 0` to
`actions/checkout` for a "full history" concern. The workflow already
performs a `git push` of a tag under the current (default, effectively
shallow) checkout settings and that already works correctly for this repo's
one existing release — semantic-release's own git handling has already been
proven sufficient here. The only new git operation this change adds is a
second `git push` (a commit, instead of a tag) through the same
already-fetched working copy and the same persisted `GITHUB_TOKEN`
credential, so there's no reason to expect it to need different checkout
settings.

The only real new requirement is external to this repo's workflow file: the
branch-protection bypass actor described above.

### Documentation

Update the parts of the docs that currently assert `@semantic-release/git` is
deliberately excluded, since that's no longer true:

- The comment block at the top of `release.config.js`.
- The "Releases & versioning" section of `README.md`.

Both should explain the new plugin list, that `CHANGELOG.md` is now generated
and committed by CI, and (in the README) the branch-protection bypass this
depends on.

### CHANGELOG.md itself

Not hand-authored in this PR. `@semantic-release/changelog` creates the file
on the next successful release after this merges (it prepends new sections
above older ones, creating the file the first time it doesn't exist). History
starts from that point forward — the existing `v1.0.0` release notes remain
only on the GitHub Releases page, which is fine: this feature is about
future releases, not backfilling the one release that already happened.

## Out of scope

- Adding the branch-protection bypass actor (owned by the sibling Terraform
  PR).
- Backfilling changelog entries for `v1.0.0`.
- Any change to `commitlint.config.js`, `AGENT.md`, or `CLAUDE.md` — none of
  their content becomes inaccurate as a result of this change.

## Testing

There's no way to exercise semantic-release's actual publish behavior outside
a real release run (it requires a real GitHub push event to `main` and a real
`GITHUB_TOKEN`). Verification for this PR is:

- `pnpm exec semantic-release --dry-run` locally (or check that the config
  loads and plugin resolution succeeds) to confirm `release.config.js` is
  syntactically valid and the two new plugins resolve.
- Manual review of plugin order and options against semantic-release's
  documented recommendation.
- The real end-to-end proof only happens on the first release after both
  this PR and the sibling Terraform PR are on `main`.
