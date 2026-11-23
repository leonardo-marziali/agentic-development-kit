#!/usr/bin/env bash
# Checks that every tool and plugin the image promises is actually present.
# Run inside a container built from the image (CI does this on pull
# requests).
set -euo pipefail

for bin in claude marksman jdtls java pyright-langserver \
  typescript-language-server markdownlint prettier ruff pyright sonar docker gh gh-login wiki \
  editorconfig-checker mmdc chromium; do
  path="$(command -v "${bin}")" || { echo "missing binary: ${bin}" >&2; exit 1; }
  printf '%-28s %s\n' "${bin}" "${path}"
done

claude --version
sonar --version
python3 -c 'import yaml'
editorconfig-checker --version

# mmdc must actually render: Puppeteer has to find Debian's chromium and be
# able to start it as the non-root user (no sandbox inside a container).
mmdc_dir="$(mktemp -d)"
printf 'graph TD\n  A --> B\n' >"${mmdc_dir}/in.mmd"
printf '{"args":["--no-sandbox"]}\n' >"${mmdc_dir}/puppeteer.json"
mmdc -q -p "${mmdc_dir}/puppeteer.json" -i "${mmdc_dir}/in.mmd" -o "${mmdc_dir}/out.svg"
grep -q '<svg' "${mmdc_dir}/out.svg" || { echo "mmdc produced no SVG" >&2; exit 1; }
rm -rf "${mmdc_dir}"
wiki --help >/dev/null

# llm-wiki: the wiki-lookup skill, and where the CLI looks for mounted wikis.
[[ -f "${HOME}/.claude/skills/wiki-lookup/SKILL.md" ]] \
  || { echo "missing skill: wiki-lookup" >&2; exit 1; }
[[ "${LLM_WIKI_SCAN_DIR:-}" == "/home/node/llm-wiki" ]] \
  || { echo "LLM_WIKI_SCAN_DIR not set to /home/node/llm-wiki" >&2; exit 1; }

# The `wiki` wrapper must find a mount point that is one wiki, a folder of
# wikis, and wikis already listed in LLM_WIKI_PATH. Throwaway git identity
# and registry, so the user's own are untouched and nothing comes from them.
wiki_dir="$(mktemp -d)"
printf '[user]\n\tname = smoke\n\temail = smoke@example.invalid\n' >"${wiki_dir}/gitconfig"
export GIT_CONFIG_GLOBAL="${wiki_dir}/gitconfig"
for w in single many/alpha many/beta elsewhere; do
  LLM_WIKI_HOME="${wiki_dir}/init-home" wiki init "${wiki_dir}/${w}" --name "${w##*/}" >/dev/null
done
mkdir "${wiki_dir}/many/not-a-wiki"
wiki_names() {
  LLM_WIKI_HOME="${wiki_dir}/empty-home" LLM_WIKI_SCAN_DIR="$1" LLM_WIKI_PATH="${2:-}" \
    wiki status --all --format json \
    | python3 -c 'import json,sys; print(" ".join(sorted(r["name"] for r in json.load(sys.stdin))))'
}
[[ "$(wiki_names "${wiki_dir}/single")" == "single" ]] \
  || { echo "wiki: single-wiki mount not found" >&2; exit 1; }
[[ "$(wiki_names "${wiki_dir}/many" "${wiki_dir}/elsewhere")" == "alpha beta elsewhere" ]] \
  || { echo "wiki: folder of wikis or LLM_WIKI_PATH entry not found" >&2; exit 1; }
unset GIT_CONFIG_GLOBAL
rm -rf "${wiki_dir}"

expected=(
  markdown@agentic-development-kit
  prettier@agentic-development-kit
  editorconfig@agentic-development-kit
  python@agentic-development-kit
  sonarqube@agentic-development-kit
  git@agentic-development-kit
  github@agentic-development-kit
  java@agentic-development-kit
  diagrams@agentic-development-kit
  writing@agentic-development-kit
  github@claude-plugins-official
  superpowers@superpowers-marketplace
  context7@context7-marketplace
  jdtls-lsp@claude-plugins-official
  pyright-lsp@claude-plugins-official
  typescript-lsp@claude-plugins-official
  skill-creator@claude-plugins-official
  claude-code-setup@claude-plugins-official
)
installed="$(claude plugin list)"
missing=0
for plugin in "${expected[@]}"; do
  if ! grep -qF "${plugin}" <<<"${installed}"; then
    echo "missing plugin: ${plugin}" >&2
    missing=1
  fi
done
exit "${missing}"
