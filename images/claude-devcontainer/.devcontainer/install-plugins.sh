#!/usr/bin/env bash
# Registers the marketplaces and installs the Claude Code plugins baked into
# the image. Runs as the image's non-root user, so everything lands in that
# user's ~/.claude (user scope) and is active in every project the container
# opens.
#
# `claude plugin install` also runs `npm ci --ignore-scripts` for any plugin
# that ships a package-lock.json (this repo's markdown, prettier and
# sonarqube and python plugins), so node/npm must already be on PATH.
set -euo pipefail

# Git ref of this repository's marketplace to install from. Empty (the
# default, and what every published image uses) means the default branch.
# Pull request builds set it to the PR's branch, so a plugin the PR adds is
# installable before it reaches main.
MARKETPLACE_REF="${MARKETPLACE_REF:-}"

MARKETPLACES=(
  # This repository. Installed from GitHub rather than the build context so
  # `claude plugin update` keeps working in containers built from the image.
  "leonardo-marziali/agentic-development-kit${MARKETPLACE_REF:+@${MARKETPLACE_REF}}"
  "anthropics/claude-plugins-official"
  "obra/superpowers-marketplace"
  "upstash/context7"
)

PLUGINS=(
  # agentic-development-kit (github@ pulls in github@claude-plugins-official
  # and python@ pulls in pyright-lsp@claude-plugins-official, as declared
  # dependencies)
  "markdown@agentic-development-kit"
  "prettier@agentic-development-kit"
  "python@agentic-development-kit"
  "sonarqube@agentic-development-kit"
  "git@agentic-development-kit"
  "github@agentic-development-kit"
  # Third-party
  "superpowers@superpowers-marketplace"
  "context7@context7-marketplace"
  "jdtls-lsp@claude-plugins-official"
  "pyright-lsp@claude-plugins-official"
  "typescript-lsp@claude-plugins-official"
  "skill-creator@claude-plugins-official"
  "claude-code-setup@claude-plugins-official"
)

for marketplace in "${MARKETPLACES[@]}"; do
  echo "==> marketplace: ${marketplace}"
  claude plugin marketplace add "${marketplace}"
done

for plugin in "${PLUGINS[@]}"; do
  echo "==> plugin: ${plugin}"
  claude plugin install --scope user "${plugin}"
done

claude plugin list
