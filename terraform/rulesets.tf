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
    pull_request {
      required_approving_review_count   = 0
      dismiss_stale_reviews_on_push     = false
      require_code_owner_review         = false
      require_last_push_approval        = false
      required_review_thread_resolution = false
      allowed_merge_methods             = ["squash"]
    }

    required_status_checks {
      strict_required_status_checks_policy = false
      do_not_enforce_on_create             = false

      # .github/workflows/plugin-tests.yml's `required` job (that workflow
      # explains why its name is kept stable).
      required_check {
        context = "Required"
      }

      # .github/workflows/pr-title.yml's `lint` job.
      required_check {
        context = "lint"
      }
    }
  }

  bypass_actors {
    actor_id    = 5
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
  }
}
