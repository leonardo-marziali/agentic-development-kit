# Terraform-Managed GitHub Rulesets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring this repo's two existing GitHub branch-protection rulesets under Terraform management, with zero behavior change, backed by an HCP Terraform (Terraform Cloud) state backend and GitHub Actions CI to plan on PRs and apply on merge to `main`.

**Architecture:** A `terraform/` directory holds HCL for the `integrations/github` provider's `github_repository_ruleset` resource — one resource per existing ruleset, reproducing their live configuration exactly. `import` blocks reconcile Terraform's state with the two already-existing rulesets on the first `apply` (import blocks affect `plan` output but only mutate state on `apply`, so the PR's plan run stays read-only). State is stored remotely in HCP Terraform (workspace `agentic-development-kit-rulesets`, CLI-driven/local execution mode) via a `cloud` block; GitHub Actions runs the actual `terraform plan`/`apply` commands.

**Tech Stack:** Terraform 1.16.x, `integrations/github` provider ~> 6.13, HCP Terraform (Terraform Cloud) for state, GitHub Actions.

## Global Constraints

- Zero behavior change to either ruleset's actual enforcement — this plan only changes _how_ they're edited going forward. Any diff beyond "N to import" in the Task 5 CI plan run means an HCL mistake, not an intentional change.
- Two independently named secrets already exist / will exist as GitHub Actions repo secrets: `TF_API_TOKEN` (HCP Terraform auth, already set) and `REPO_ADMIN` (a fine-grained PAT with `Administration: write` + `Contents: read` on this repo, for the GitHub provider — the user is creating this; do not attempt to create it and do not proceed past Task 5's CI run without it existing).
- Do not add a bypass actor to either ruleset in this plan — that is an explicitly separate follow-up (see spec's Non-goals), coordinated with [PR #7](https://github.com/leonardo-marziali/agentic-development-kit/pull/7).
- The `integrations/github` provider's `pull_request` rule block does not expose `require_extra_approval_for_unattributed_changes` (confirmed against the provider's current docs — see Task 2). The live "Require pull request for default branch" ruleset has this set to `true`. Terraform will not manage this field; it must be called out with a code comment (Task 2) so a future editor of `rules.pull_request` doesn't assume Terraform has full control of that rule's settings.
- Full source spec: [docs/superpowers/specs/2026-09-06-terraform-github-rulesets-design.md](../specs/2026-09-06-terraform-github-rulesets-design.md).

---

### Task 1: Terraform scaffolding (backend, provider, variable)

**Files:**

- Create: `terraform/versions.tf`
- Create: `terraform/providers.tf`
- Create: `terraform/variables.tf`
- Modify: `.gitignore`

**Interfaces:**

- Produces: `var.github_token` (declared in `variables.tf`, consumed by `providers.tf` in this task, and available to any resource added in Task 2+).

- [ ] **Step 1: Create `terraform/versions.tf`**

```hcl
terraform {
  required_version = ">= 1.9.0"

  cloud {
    organization = "leonardo-marziali"

    workspaces {
      name = "agentic-development-kit-rulesets"
    }
  }

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.13"
    }
  }
}
```

- [ ] **Step 2: Create `terraform/variables.tf`**

```hcl
variable "github_token" {
  description = "Fine-grained PAT with Administration:write and Contents:read on this repo. Authenticates the github provider for managing repository rulesets (GITHUB_TOKEN from GitHub Actions cannot be used here — it does not carry the administration permission the rulesets API requires)."
  type        = string
  sensitive   = true
}
```

- [ ] **Step 3: Create `terraform/providers.tf`**

```hcl
provider "github" {
  owner = "leonardo-marziali"
  token = var.github_token
}
```

- [ ] **Step 4: Update `.gitignore`**

Add a new section so Terraform's local artifacts are never accidentally
committed (state lives in HCP Terraform, never locally or in the repo):

```gitignore
node_modules/
coverage/
.scratch/
.DS_Store
dist/

# Terraform
terraform/.terraform/
terraform/*.tfstate
terraform/*.tfstate.*
terraform/crash.log
terraform/crash.*.log
terraform/*.tfvars
terraform/*.tfvars.json
terraform/override.tf
terraform/override.tf.json
terraform/*_override.tf
terraform/*_override.tf.json
.terraformrc
terraform.rc
```

- [ ] **Step 5: Validate syntax without touching the HCP backend**

`terraform init` normally tries to connect to the configured `cloud`
workspace, which needs `TF_API_TOKEN` — not available in this environment.
`-backend=false` skips that while still installing the provider, so `fmt`
and `validate` can run against real provider schema. Use plain `fmt`
(auto-fixing), not `-check`, for this local step — CI's `terraform-plan.yml`
(Task 4) is where formatting is actually enforced as a gate.

Run:

```bash
cd terraform && terraform fmt -recursive && terraform init -backend=false && terraform validate
```

Expected: `fmt` prints nothing if already canonically formatted, or lists
the file(s) it rewrote; `init` reports "Terraform has been successfully
initialized!"; `validate` prints `Success! The configuration is valid.`

- [ ] **Step 6: Commit**

```bash
git add terraform/versions.tf terraform/providers.tf terraform/variables.tf .gitignore
git commit -m "feat(terraform): scaffold backend and github provider config"
```

---

### Task 2: Ruleset resources matching live configuration

**Files:**

- Create: `terraform/rulesets.tf`

**Interfaces:**

- Consumes: `var.github_token` (from Task 1, via the `github` provider — not referenced directly in this file).
- Produces: `github_repository_ruleset.block_force_pushes`, `github_repository_ruleset.require_pull_request` (resource addresses consumed by Task 3's `import` blocks and Task 5's CI plan/apply).

The live configuration being reproduced (fetched via
`gh api repos/leonardo-marziali/agentic-development-kit/rulesets/22342416`
and `.../rulesets/22341902`, see the spec's Problem section) — this task's
test is that the CI plan in Task 5 shows these two resources as pure imports
with **no other changes**.

- [ ] **Step 1: Create `terraform/rulesets.tf`**

```hcl
resource "github_repository_ruleset" "block_force_pushes" {
  name        = "Block force pushes on default branch"
  repository  = "agentic-development-kit"
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    non_fast_forward = true
  }
}

resource "github_repository_ruleset" "require_pull_request" {
  name        = "Require pull request for default branch"
  repository  = "agentic-development-kit"
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    # NOTE: GitHub's API reports this ruleset's pull_request rule as also
    # having require_extra_approval_for_unattributed_changes = true. The
    # integrations/github provider (checked against v6.13 docs) does not
    # expose that field on rules.pull_request, so Terraform cannot manage
    # it. It has been left at its current live value by not touching this
    # rule block on the initial import. Any future edit to this
    # pull_request block should be followed by re-checking
    # `gh api repos/leonardo-marziali/agentic-development-kit/rulesets/22341902`
    # to confirm that field wasn't reset.
    pull_request {
      required_approving_review_count   = 0
      dismiss_stale_reviews_on_push     = false
      require_code_owner_review         = false
      require_last_push_approval        = false
      required_review_thread_resolution = false
      allowed_merge_methods             = ["merge", "squash", "rebase"]
    }

    required_status_checks {
      strict_required_status_checks_policy = false
      do_not_enforce_on_create             = false

      required_check {
        context = "Required"
      }

      required_check {
        context = "lint"
      }
    }
  }
}
```

- [ ] **Step 2: Validate syntax**

```bash
cd terraform && terraform fmt -recursive && terraform validate
```

(`terraform init -backend=false` from Task 1 already installed the
provider; re-run it first if this is a fresh shell.)

Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add terraform/rulesets.tf
git commit -m "feat(terraform): define the two branch-protection rulesets"
```

---

### Task 3: Import blocks

**Files:**

- Create: `terraform/import.tf`

**Interfaces:**

- Consumes: `github_repository_ruleset.block_force_pushes`, `github_repository_ruleset.require_pull_request` (resource addresses from Task 2).

The `integrations/github` provider imports rulesets using the ID format
`<repository>:<ruleset_id>` (confirmed against the provider's docs' Import
section).

- [ ] **Step 1: Create `terraform/import.tf`**

```hcl
import {
  to = github_repository_ruleset.block_force_pushes
  id = "agentic-development-kit:22342416"
}

import {
  to = github_repository_ruleset.require_pull_request
  id = "agentic-development-kit:22341902"
}
```

- [ ] **Step 2: Validate syntax**

```bash
cd terraform && terraform fmt -recursive && terraform validate
```

Expected: `Success! The configuration is valid.` (Import blocks are
evaluated for real against live state only during `plan`/`apply` against
the HCP backend, which happens in Task 5 via CI — `validate` only checks
that the block itself is well-formed and references a declared resource.)

- [ ] **Step 3: Commit**

```bash
git add terraform/import.tf
git commit -m "feat(terraform): import existing rulesets into state on first apply"
```

---

### Task 4: CI workflows

**Files:**

- Create: `.github/workflows/terraform-plan.yml`
- Create: `.github/workflows/terraform-apply.yml`

**Interfaces:**

- Consumes: repo secrets `TF_API_TOKEN`, `REPO_ADMIN` (both external to this repo's code — `TF_API_TOKEN` already set, `REPO_ADMIN` created by the user before Task 5's CI run can succeed).

- [ ] **Step 1: Create `.github/workflows/terraform-plan.yml`**

```yaml
name: Terraform Plan

on:
  pull_request:
    paths:
      - 'terraform/**'

permissions:
  contents: read

defaults:
  run:
    working-directory: terraform

jobs:
  plan:
    runs-on: ubuntu-latest
    env:
      TF_TOKEN_app_terraform_io: ${{ secrets.TF_API_TOKEN }}
      TF_VAR_github_token: ${{ secrets.REPO_ADMIN }}
    steps:
      - uses: actions/checkout@v7

      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: '1.16.1'

      - run: terraform fmt -check -recursive

      - run: terraform init

      - run: terraform validate

      - run: terraform plan
```

- [ ] **Step 2: Create `.github/workflows/terraform-apply.yml`**

```yaml
name: Terraform Apply

on:
  push:
    branches: [main]
    paths:
      - 'terraform/**'

permissions:
  contents: read

defaults:
  run:
    working-directory: terraform

jobs:
  apply:
    runs-on: ubuntu-latest
    env:
      TF_TOKEN_app_terraform_io: ${{ secrets.TF_API_TOKEN }}
      TF_VAR_github_token: ${{ secrets.REPO_ADMIN }}
    steps:
      - uses: actions/checkout@v7

      - uses: hashicorp/setup-terraform@v4
        with:
          terraform_version: '1.16.1'

      - run: terraform init

      - run: terraform apply -auto-approve
```

- [ ] **Step 3: Validate YAML syntax locally**

No `actionlint`/`yamllint` binary is available in this environment; `PyYAML`
is, so use it as a real syntax check (not a placeholder — this actually
parses the files and fails loudly on malformed YAML):

```bash
python3 -c "
import yaml
for f in ['.github/workflows/terraform-plan.yml', '.github/workflows/terraform-apply.yml']:
    yaml.safe_load(open(f))
    print(f, 'OK')
"
```

Expected:

```text
.github/workflows/terraform-plan.yml OK
.github/workflows/terraform-apply.yml OK
```

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/terraform-plan.yml .github/workflows/terraform-apply.yml
git commit -m "ci(terraform): plan on PR, apply on merge to main"
```

---

### Task 5: Push, open PR, verify the real plan

This is the task where the design's real assumption gets checked against
live GitHub/HCP state — everything before this was static/local validation.

**Files:** none (no new files; this task pushes and observes CI).

**Interfaces:** none (terminal task).

- [ ] **Step 1: Confirm `REPO_ADMIN` exists**

Ask the user to confirm the `REPO_ADMIN` fine-grained PAT (`Administration:
write`, `Contents: read`, scoped to
`leonardo-marziali/agentic-development-kit`) has been created and saved as
a repo secret. Do not proceed to Step 2 without an explicit yes — the
`terraform-plan.yml` run in Step 3 will fail authenticating to the GitHub
API otherwise, and that failure is not a code bug to fix.

- [ ] **Step 2: Push the branch**

Ask the user for explicit confirmation before pushing (per this session's
established git safety practice), then:

```bash
git push -u origin feat/terraform-github-rulesets
```

- [ ] **Step 3: Open the PR**

Use the `github:pr` skill to open the PR. Its description must state, in
its own section, the exact expected `terraform-plan.yml` result: **2 to
import, 0 to add, 0 to change, 0 to destroy** — and that any other diff
means the HCL doesn't yet match live configuration and must be fixed before
merging (per the spec's Rollout section).

- [ ] **Step 4: Watch and verify the plan output**

Once `terraform-plan.yml` runs (the `github:pr` skill's CI-watching loop
covers this), read its `terraform plan` step output. It must show exactly:

```text
Plan: 2 to import, 0 to add, 0 to change, 0 to destroy.
```

If it shows anything else (an additional change on either resource, or an
error), do not merge. Fix `terraform/rulesets.tf` to match live
configuration exactly, push the fix, and re-check this step — do not
special-case or explain away an unexpected diff.

- [ ] **Step 5: Report back, do not merge**

Per this repo's convention (and the `github:pr` skill), merging needs
explicit user confirmation. Report the plan output and ask whether to
merge now or hold — for example if the user wants to first verify
`REPO_ADMIN`'s scopes are correct against `terraform-apply.yml`'s
post-merge run before treating this as done.
