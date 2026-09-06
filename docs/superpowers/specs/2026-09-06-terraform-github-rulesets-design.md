# Terraform-managed GitHub rulesets (HCP Terraform backend)

## Problem

This repo's `main` branch is protected by two GitHub repository rulesets,
created and edited directly through the GitHub UI/API:

- **"Block force pushes on default branch"** (id `22342416`) — blocks
  non-fast-forward pushes to the default branch.
- **"Require pull request for default branch"** (id `22341902`) — requires a
  PR (0 approvals currently required) and the `Required` and `lint` status
  checks.

Neither has any bypass actors configured. A near-term need (tracked
separately, see [PR #7](https://github.com/leonardo-marziali/agentic-development-kit/pull/7))
is to add a bypass actor so the release workflow can push a generated
`CHANGELOG.md` back to `main`. Editing branch protection ad hoc via the UI/API
has no review step and no history — the wrong edit is a silent, unreviewed
change to how every future PR merges. This work brings both rulesets under
Terraform management so future edits (including that bypass) are ordinary,
reviewable PR diffs.

## Goals

- Express both existing rulesets as Terraform resources with **zero behavior
  change** — this PR only moves configuration under management, it does not
  alter what the rulesets do.
- CI plans changes on every PR that touches the Terraform code, and applies
  them automatically on merge to `main`.
- No new ClickOps: once merged, all ruleset changes go through Terraform.

## Non-goals

- Adding the release-bot bypass actor itself — that's a follow-up PR, once
  this plumbing exists, coordinated with [PR #7](https://github.com/leonardo-marziali/agentic-development-kit/pull/7).
- Managing any other repository settings (labels, webhooks, teams, etc.) —
  scope is strictly the two existing rulesets.
- A generic/reusable Terraform module — this is a two-resource, single-repo
  setup; over-abstracting it isn't warranted.

## Architecture

### State backend: HCP Terraform (Terraform Cloud)

State is stored remotely in HCP Terraform, organization `leonardo-marziali`,
workspace `agentic-development-kit-rulesets`, configured via a `cloud` block
in `terraform/versions.tf`. The workspace runs in **CLI-driven / local
execution mode**: HCP Terraform stores and locks state, but the actual
`plan`/`apply` commands run inside GitHub Actions (matching how `release.yml`
already runs its own release logic in-workflow, rather than delegating to an
external trigger). The workspace already exists (set up by the user).

### Import strategy

Both rulesets already exist in GitHub; they are not being created fresh.
`terraform/import.tf` declares `import` blocks pointing at the live ruleset
IDs (`22342416`, `22341902`). Import blocks only take effect during
`terraform apply`, not `terraform plan` — so the PR's plan run is read-only
against the shared HCP state, and the first `terraform apply` (triggered by
this PR's merge to `main`) performs the one-time import into HCP-managed
state. No local `terraform import` step, and no local Terraform install, is
needed by anyone. `import.tf` can be deleted in a small follow-up once that
first apply has succeeded — harmless to leave in the meantime, just redundant
after the resources are in state.

### Authentication

Two independent credentials, for two independent concerns — kept in
distinctly named secrets so that's never ambiguous:

- **`TF_API_TOKEN`** (already set as a repo secret) — authenticates Terraform
  to HCP Terraform itself, for state storage/locking. Passed to the `cloud`
  block via the `TF_TOKEN_app_terraform_io` environment variable (HCP
  Terraform's documented `TF_TOKEN_<hostname>` convention, dots replaced with
  underscores).
- **`REPO_ADMIN`** (a fine-grained PAT the user will create, scoped to this
  repo with `Administration: write` and `Contents: read`) — authenticates the
  `integrations/github` Terraform provider to GitHub's rulesets API.
  `GITHUB_TOKEN`, the token GitHub Actions provides automatically, does _not_
  carry the `administration` permission the rulesets API requires, so it
  cannot be used here. Passed to the provider via `variable "github_token"`
  (marked `sensitive`), populated from the environment as `TF_VAR_github_token`.

### File layout

New `terraform/` directory:

- `versions.tf` — `terraform {}` block: required Terraform version, the
  `cloud` block (org + workspace), and the pinned `integrations/github`
  provider version constraint.
- `providers.tf` — `provider "github" { owner = "leonardo-marziali", token = var.github_token }`.
- `variables.tf` — `variable "github_token"` (sensitive, no default).
- `rulesets.tf` — two `github_repository_ruleset` resources reproducing the
  two live rulesets: same names, `target = "branch"`, `enforcement = "active"`,
  the same `ref_name` condition (`include = ["~DEFAULT_BRANCH"]`), the same
  rules (`non_fast_forward` on the first; `pull_request` and
  `required_status_checks` with today's exact parameters on the second), and
  no bypass actors.
- `import.tf` — the two `import` blocks described above.

Exact HCL attribute/block names will be verified against the
`integrations/github` provider's current schema during implementation (its
schema doesn't necessarily mirror the raw REST API field-for-field, and some
newer GitHub ruleset options may lag behind in provider support). If any
setting the live rulesets have today turns out not to be representable in the
pinned provider version, that gap will be called out explicitly in the PR
rather than silently dropped or approximated.

`.terraform.lock.hcl` is committed (standard practice, pins resolved provider
versions); `.terraform/` and any local `*.tfstate*` are gitignored (state
lives in HCP, never locally or in the repo).

### CI workflows

- **`.github/workflows/terraform-plan.yml`** — triggers on `pull_request`
  events touching `terraform/**`. Steps: checkout, `hashicorp/setup-terraform`,
  `terraform fmt -check -recursive`, `terraform init`, `terraform validate`,
  `terraform plan`. Uses both secrets as described above. Read-only —
  performs no import, no state mutation.
- **`.github/workflows/terraform-apply.yml`** — triggers on `push` to `main`
  touching `terraform/**`. Steps: checkout, `hashicorp/setup-terraform`,
  `terraform init`, `terraform apply -auto-approve`. This run performs the
  one-time import described above the first time it executes after merge.

Neither workflow is added to the ruleset's required status checks in this
PR — that's an orthogonal decision left for later, not needed for this change
to be safe.

## Rollout

1. `terraform-plan.yml` runs on this PR. `terraform plan` evaluates the
   `import` blocks even though it doesn't execute them — its output must show
   exactly **2 to import, 0 to add/change/destroy**. Any additional diff means
   the HCL doesn't yet match live config exactly, and gets fixed in this PR
   before merging.
2. Merge this PR to `main`.
3. `terraform-apply.yml` runs, executing that same plan: both rulesets get
   imported into HCP-managed state, no other changes applied.
4. Optionally, in a small follow-up: delete `import.tf` now that both
   resources are in state.
5. Future ruleset changes (starting with the release-bot bypass actor) are
   ordinary PRs against `terraform/rulesets.tf`.

## Rollback

If the apply misbehaves, the two rulesets still exist in GitHub regardless of
Terraform's state — reverting the merge commit and (if needed) manually
correcting via the GitHub UI remains available as a last resort. Because nothing
about the rulesets' actual enforcement changes in this PR, the blast radius of
a mistake here is limited to _how_ the ruleset is edited going forward, not to
`main`'s protection itself.

## Testing

- `terraform fmt -check` and `terraform validate` (via CI, and locally if a
  `terraform` binary is available).
- Manual diff of the HCL against the two rulesets' current JSON (already
  fetched from `gh api repos/leonardo-marziali/agentic-development-kit/rulesets/{id}`)
  to confirm the "zero behavior change" goal before merging.
- `terraform-plan.yml`'s output on the PR must show only the two imports,
  nothing else, before merging.
- Post-merge: confirm `terraform-apply.yml` succeeds and the two rulesets
  still show identical settings via `gh api .../rulesets/{id}`.
