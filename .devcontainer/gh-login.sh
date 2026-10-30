#!/usr/bin/env bash
# Logs the GitHub CLI in from GITHUB_PERSONAL_ACCESS_TOKEN (set in the
# gitignored `.env`, passed to the container via --env-file). gh only reads
# GH_TOKEN / GITHUB_TOKEN on its own, so without this step `gh` is
# unauthenticated even though the token is in the environment.
# Runs on every container start; does nothing if there is no token or gh is
# already logged in, and never fails the start.
set -uo pipefail

if ! command -v gh >/dev/null; then
  echo "gh not found; pull a newer claude-devcontainer image" >&2
  exit 0
fi

if [[ -z "${GITHUB_PERSONAL_ACCESS_TOKEN:-}" ]]; then
  echo "gh: GITHUB_PERSONAL_ACCESS_TOKEN not set in .env; skipping login"
  exit 0
fi

# `gh auth login --with-token` refuses to run when GH_TOKEN/GITHUB_TOKEN is
# set, so clear them for this command.
if env -u GH_TOKEN -u GITHUB_TOKEN gh auth status >/dev/null 2>&1; then
  echo "gh: already logged in"
  exit 0
fi

printf '%s' "$GITHUB_PERSONAL_ACCESS_TOKEN" |
  env -u GH_TOKEN -u GITHUB_TOKEN gh auth login --with-token &&
  gh auth setup-git &&
  echo "gh: logged in"
exit 0
