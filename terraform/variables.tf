variable "github_token" {
  description = "Fine-grained PAT with Administration:write and Contents:read on this repo. Authenticates the github provider for managing repository rulesets (GITHUB_TOKEN from GitHub Actions cannot be used here — it does not carry the administration permission the rulesets API requires)."
  type        = string
  sensitive   = true
}
