#!/usr/bin/env bash
# Checks that every tool and plugin the image promises is actually present.
# Run inside a container built from the image (CI does this on pull
# requests).
set -euo pipefail

for bin in claude marksman jdtls java pyright-langserver \
  typescript-language-server markdownlint prettier ruff pyright sonar docker gh gh-login wiki; do
  path="$(command -v "${bin}")" || { echo "missing binary: ${bin}" >&2; exit 1; }
  printf '%-28s %s\n' "${bin}" "${path}"
done

claude --version
sonar --version
python3 -c 'import yaml'
wiki --help >/dev/null

# llm-wiki: the wiki-lookup skill, and where the CLI looks for a mounted wiki.
[[ -f "${HOME}/.claude/skills/wiki-lookup/SKILL.md" ]] \
  || { echo "missing skill: wiki-lookup" >&2; exit 1; }
[[ "${LLM_WIKI_PATH:-}" == "/home/node/llm-wiki" ]] \
  || { echo "LLM_WIKI_PATH not set to /home/node/llm-wiki" >&2; exit 1; }

expected=(
  markdown@agentic-development-kit
  prettier@agentic-development-kit
  python@agentic-development-kit
  sonarqube@agentic-development-kit
  git@agentic-development-kit
  github@agentic-development-kit
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
