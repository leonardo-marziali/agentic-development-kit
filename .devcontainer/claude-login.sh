#!/usr/bin/env bash
# Logs Claude Code in when it isn't already. Meant to run in an interactive
# terminal (the `claude login` VS Code task runs it when the folder opens),
# because the login flow asks you to open a URL and paste a code back.
# Does nothing if already logged in, so it is safe to run on every start.
set -uo pipefail

if ! command -v claude >/dev/null; then
  echo "claude not found; pull a newer claude-devcontainer image" >&2
  exit 0
fi

if claude auth status >/dev/null 2>&1; then
  echo "claude: already logged in"
  exit 0
fi

claude auth login
