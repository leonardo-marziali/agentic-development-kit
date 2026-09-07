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
