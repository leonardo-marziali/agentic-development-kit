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
