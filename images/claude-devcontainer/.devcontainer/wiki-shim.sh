#!/usr/bin/env bash
# Installed as /usr/local/bin/wiki in front of the real llm-wiki CLI.
#
# The CLI only takes wiki roots (directories holding wiki.toml) in
# LLM_WIKI_PATH and never looks inside other directories. This wrapper makes
# the mount point at LLM_WIKI_SCAN_DIR work both as a single wiki and as a
# folder of wikis: it adds the directory itself and each direct subdirectory
# holding a wiki.toml in front of any LLM_WIKI_PATH already set, then runs
# the real CLI. It scans on every call, so nothing goes stale when mounts
# change. The CLI drops duplicate entries itself.
set -euo pipefail

readonly REAL_WIKI="/opt/llm-wiki/bin/wiki"
scan_dir="${LLM_WIKI_SCAN_DIR:-/home/node/llm-wiki}"

found=()
if [[ -f "${scan_dir}/wiki.toml" ]]; then
  found+=("${scan_dir}")
fi
shopt -s nullglob
for toml in "${scan_dir}"/*/wiki.toml; do
  found+=("${toml%/wiki.toml}")
done
shopt -u nullglob

if ((${#found[@]} > 0)); then
  joined="$(IFS=:; printf '%s' "${found[*]}")"
  export LLM_WIKI_PATH="${joined}${LLM_WIKI_PATH:+:${LLM_WIKI_PATH}}"
fi

exec "${REAL_WIKI}" "$@"
