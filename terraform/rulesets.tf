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
    # it. This pull_request block IS modified by this change (see
    # allowed_merge_methods below), and GitHub's ruleset API replaces a
    # rule's parameters wholesale on update — so the first apply that
    # rewrites this block will very likely reset
    # require_extra_approval_for_unattributed_changes to false, since the
    # provider has no way to send a field it doesn't model. After that
    # apply, check:
    # `gh api repos/leonardo-marziali/agentic-development-kit/rulesets/22341902 --jq '.rules[] | select(.type=="pull_request").parameters.require_extra_approval_for_unattributed_changes'`
    # and if it comes back `false`, manually restore it to `true` via the
    # GitHub UI (Settings -> Rules -> Rulesets). From that point it is
    # permanently unmanaged by Terraform — any future edit to this
    # pull_request block will reset it again, requiring the same manual
    # restoration. This is an accepted, one-off gap, not a bug to keep
    # re-fixing in code.
    pull_request {
      required_approving_review_count   = 0
      dismiss_stale_reviews_on_push     = false
      require_code_owner_review         = false
      require_last_push_approval        = false
      required_review_thread_resolution = false
      # Restricted from the live [merge, squash, rebase] to squash-only,
      # aligning enforcement with this repo's already-documented
      # squash-only merge policy (see AGENT.md's "Merging" section). This
      # is an intentional behavior change, not a reproduction of live
      # config — see the "1 to change" note on this resource.
      allowed_merge_methods = ["squash"]
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

  # Lets .github/workflows/release.yml push its generated commit (via
  # @semantic-release/git) and tag straight to main. GitHub rejects a
  # GitHub App (actor_type "Integration") as a bypass actor unless the
  # repository belongs to an organization the app is installed on — this
  # repo is a personal account, so that path is unavailable (confirmed via
  # a live 422: "Actor GitHub Actions integration must be part of the
  # ruleset source or owner organization"). release.yml instead
  # authenticates its push with the REPO_ADMIN PAT (an admin on this repo)
  # rather than the default GITHUB_TOKEN, and this RepositoryRole bypass
  # covers that account. actor_id 5 is the built-in "admin" role
  # (integrations/github provider docs: maintain=2, write=4, admin=5).
  # bypass_mode "always" covers both the tag push and the direct commit
  # push — release.yml never opens a PR.
  bypass_actors {
    actor_id    = 5
    actor_type  = "RepositoryRole"
    bypass_mode = "always"
  }
}
