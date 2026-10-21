#!/usr/bin/env bash
# Starts Claude Code in server mode (`claude remote-control`) inside a
# detached tmux session, so it keeps running after the terminal that started
# it is closed or VS Code disconnects. Does nothing if the session already
# exists, so it is safe to run on every container start.
#
#   tmux attach -t claude    look at it (log in, answer prompts)
#   Ctrl-b d                 detach again, leaving it running
#
# If claude exits (for example because it is not logged in yet), the tmux
# session drops to a shell instead of closing, so it can be attached to, and
# claude logged in and restarted from there.
set -euo pipefail

SESSION="${CLAUDE_TMUX_SESSION:-claude}"

# Images built before tmux was added to claude-devcontainer don't have it.
if ! command -v tmux >/dev/null; then
  echo "tmux not found; pull a newer claude-devcontainer image to run claude in server mode" >&2
  exit 0
fi

if tmux has-session -t "=${SESSION}" 2>/dev/null; then
  echo "tmux session '${SESSION}' already running (tmux attach -t ${SESSION})"
  exit 0
fi

tmux new-session -d -s "${SESSION}" -c "${PWD}" \
  "claude remote-control; echo 'claude exited; run claude remote-control to restart it.'; exec bash -l"
echo "started claude remote-control in tmux session '${SESSION}' (tmux attach -t ${SESSION})"
