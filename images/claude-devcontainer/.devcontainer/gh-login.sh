#!/usr/bin/env bash
# Logs the GitHub CLI in from GITHUB_PERSONAL_ACCESS_TOKEN. gh only reads
# GH_TOKEN / GITHUB_TOKEN on its own, so without this step `gh` is
# unauthenticated even though the token is in the environment.
#
# The image installs this as /usr/local/bin/gh-login and runs it on every
# container start (see the postStartCommand in devcontainer.json). It does
# nothing if there is no token or gh is already logged in, and never fails
# the start.
set -uo pipefail

if ! command -v gh >/dev/null; then
  echo "gh-login: gh not found; skipping login" >&2
  exit 0
fi

if [[ -z "${GITHUB_PERSONAL_ACCESS_TOKEN:-}" ]]; then
  echo "gh-login: GITHUB_PERSONAL_ACCESS_TOKEN not set; skipping login"
  exit 0
fi

# `gh auth login --with-token` refuses to run when GH_TOKEN/GITHUB_TOKEN is
# set, so clear them for this command.
if env -u GH_TOKEN -u GITHUB_TOKEN gh auth status >/dev/null 2>&1; then
  echo "gh-login: already logged in"
  exit 0
fi

printf '%s' "$GITHUB_PERSONAL_ACCESS_TOKEN" |
  env -u GH_TOKEN -u GITHUB_TOKEN gh auth login --with-token &&
  gh auth setup-git &&
  echo "gh-login: logged in"
exit 0
