#!/usr/bin/env bash
# System-wide tooling the baked-in plugins shell out to. Runs as root, with
# the .devcontainer directory bind-mounted (see Dockerfile) so it can read
# sonarsource.asc next to it.
#
#   plugin                      needs
#   markdown                    marksman (LSP), markdownlint-cli (via npx)
#   editorconfig                editorconfig-checker
#   prettier                    prettier (via npx)
#   python                      ruff, pyright (pyright-lsp below)
#   sonarqube                   sonar CLI, docker CLI (devcontainer feature)
#   github                      gh CLI (devcontainer feature)
#   java                        JDK 21 (jdtls-lsp below)
#   diagrams                    mermaid-cli (mmdc) + Chromium, python3
#   writing                     python3
#   jdtls-lsp                   jdtls + JDK 21
#   pyright-lsp                 pyright-langserver
#   typescript-lsp              typescript-language-server + typescript
#   skill-creator               python3 + PyYAML
#   all plugins with hooks      node (base image)
#
# Plus the llm-wiki `wiki` CLI, whose wiki-lookup skill is installed for the
# non-root user by the Dockerfile.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Version value that means "resolve the newest release".
readonly LATEST="latest"
JDTLS_VERSION="${JDTLS_VERSION:-${LATEST}}"
MARKSMAN_VERSION="${MARKSMAN_VERSION:-${LATEST}}"
SONAR_CLI_VERSION="${SONAR_CLI_VERSION:-${LATEST}}"
RUFF_VERSION="${RUFF_VERSION:-${LATEST}}"
LLM_WIKI_VERSION="${LLM_WIKI_VERSION:-${LATEST}}"
EDITORCONFIG_CHECKER_VERSION="${EDITORCONFIG_CHECKER_VERSION:-${LATEST}}"
# Where host wikis are mounted (see the README): one wiki, or a folder of
# wikis. The Dockerfile points LLM_WIKI_SCAN_DIR here and the `wiki` wrapper
# (wiki-shim.sh) scans it.
readonly LLM_WIKI_MOUNT="/home/node/llm-wiki"

# Every download is HTTPS-only, redirects included.
fetch() {
  curl --proto '=https' --tlsv1.2 -fsSL "$@"
}

case "$(uname -m)" in
  x86_64 | amd64) MARKSMAN_ARCH="x64"; SONAR_PLATFORM="linux-x86-64"; GO_ARCH="amd64" ;;
  aarch64 | arm64) MARKSMAN_ARCH="arm64"; SONAR_PLATFORM="linux-arm64"; GO_ARCH="arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl git gnupg jq ripgrep unzip \
  openjdk-21-jdk-headless \
  python3 python3-pip python3-venv python3-yaml \
  chromium fonts-liberation
rm -rf /var/lib/apt/lists/*

# Node-based CLIs. Installed globally so the hooks' `npx -y <tool>` resolves
# them locally instead of downloading on first use. Only mermaid-cli has a
# lifecycle script, Puppeteer's browser download; --ignore-scripts skips it
# and the Dockerfile points Puppeteer at Debian's chromium instead.
npm install -g --ignore-scripts \
  @mermaid-js/mermaid-cli \
  markdownlint-cli \
  prettier \
  pyright \
  typescript \
  typescript-language-server
npm cache clean --force

# ruff (python plugin), from PyPI into its own venv: Debian marks the system
# interpreter externally managed. Wheels only, and pip checks each download
# against the sha256 PyPI's index publishes for it.
ruff_spec="ruff"
if [[ "${RUFF_VERSION}" != "${LATEST}" ]]; then
  ruff_spec="ruff==${RUFF_VERSION}"
fi
python3 -m venv /opt/ruff
/opt/ruff/bin/pip install --no-cache-dir --only-binary=:all: "${ruff_spec}"
ln -sf /opt/ruff/bin/ruff /usr/local/bin/ruff
ruff --version

# llm-wiki (`wiki` CLI, PyPI package llm-wiki-tool), the same way as ruff:
# its own venv, wheels only, each checked against PyPI's sha256. The
# optional docling extra is left out (it pulls in torch).
llm_wiki_spec="llm-wiki-tool"
if [[ "${LLM_WIKI_VERSION}" != "${LATEST}" ]]; then
  llm_wiki_spec="llm-wiki-tool==${LLM_WIKI_VERSION}"
fi
python3 -m venv /opt/llm-wiki
/opt/llm-wiki/bin/pip install --no-cache-dir --only-binary=:all: "${llm_wiki_spec}"
install -m 0755 "${SCRIPT_DIR}/wiki-shim.sh" /usr/local/bin/wiki
wiki --help >/dev/null
# A bind-mounted host wiki is a git repo owned by the host user's UID, which
# need not match the container user's; without this git refuses to touch it
# ("dubious ownership") and `wiki ingest` fails. The `/*` entry covers the
# wikis inside a mounted folder of wikis.
git config --system --add safe.directory "${LLM_WIKI_MOUNT}"
git config --system --add safe.directory "${LLM_WIKI_MOUNT}/*"

# marksman (markdown LSP)
if [[ "${MARKSMAN_VERSION}" == "${LATEST}" ]]; then
  marksman_url="https://github.com/artempyanykh/marksman/releases/latest/download/marksman-linux-${MARKSMAN_ARCH}"
else
  marksman_url="https://github.com/artempyanykh/marksman/releases/download/${MARKSMAN_VERSION}/marksman-linux-${MARKSMAN_ARCH}"
fi
fetch "${marksman_url}" -o /usr/local/bin/marksman
chmod 755 /usr/local/bin/marksman

# editorconfig-checker (editorconfig plugin), the release binary checked
# against the release's checksums.txt. Its hook prefers a binary on PATH over
# `npx editorconfig-checker`, whose wrapper downloads this same binary from
# the GitHub API on first use (rate-limited, and needs network).
if [[ "${EDITORCONFIG_CHECKER_VERSION}" == "${LATEST}" ]]; then
  ec_base="https://github.com/editorconfig-checker/editorconfig-checker/releases/latest/download"
else
  ec_base="https://github.com/editorconfig-checker/editorconfig-checker/releases/download/v${EDITORCONFIG_CHECKER_VERSION#v}"
fi
ec_file="editorconfig-checker-linux-${GO_ARCH}.tar.gz"
ec_tmp="$(mktemp -d)"
fetch "${ec_base}/${ec_file}" -o "${ec_tmp}/${ec_file}"
fetch "${ec_base}/checksums.txt" -o "${ec_tmp}/checksums.txt"
# Exactly one checksums.txt line must name the tarball, or nothing is checked.
[[ "$(grep -cE "  ${ec_file}\$" "${ec_tmp}/checksums.txt")" == 1 ]] \
  || { echo "editorconfig-checker: no checksum for ${ec_file}" >&2; exit 1; }
(cd "${ec_tmp}" && grep -E "  ${ec_file}\$" checksums.txt | sha256sum -c --quiet -)
tar -xzf "${ec_tmp}/${ec_file}" -C "${ec_tmp}" editorconfig-checker
install -m 755 "${ec_tmp}/editorconfig-checker" /usr/local/bin/editorconfig-checker
rm -rf "${ec_tmp}"
editorconfig-checker --version

# SonarQube CLI, verified against SonarSource's OpenPGP signature. The key
# (sonarsource.asc) is the one the CLI itself embeds for verifying its
# downloads; the build also pins its fingerprint.
SONARSOURCE_KEY_FPR="679F1EE92B19609DE816FDE81DB198F93525EC1A"
sonar_base="https://binaries.sonarsource.com/Distribution/sonarqube-cli"
if [[ "${SONAR_CLI_VERSION}" == "${LATEST}" ]]; then
  SONAR_CLI_VERSION="$(fetch "${sonar_base}/stable.version" | tr -d '[:space:]')"
fi
sonar_url="${sonar_base}/${SONAR_CLI_VERSION}/linux/sonarqube-cli-${SONAR_CLI_VERSION}-${SONAR_PLATFORM}.bin"
sonar_tmp="$(mktemp -d)"
fetch "${sonar_url}" -o "${sonar_tmp}/sonar"
fetch "${sonar_url}.asc" -o "${sonar_tmp}/sonar.asc"
# gpg won't create a --homedir itself.
mkdir -m 700 "${sonar_tmp}/gnupg"
gpg --batch --quiet --homedir "${sonar_tmp}/gnupg" --import "${SCRIPT_DIR}/sonarsource.asc"
if ! gpg --batch --homedir "${sonar_tmp}/gnupg" --status-fd 1 \
  --verify "${sonar_tmp}/sonar.asc" "${sonar_tmp}/sonar" 2>/dev/null \
  | grep -qE "^\[GNUPG:\] VALIDSIG .* ${SONARSOURCE_KEY_FPR}\$"; then
  echo "sonar CLI: signature verification failed for ${sonar_url}" >&2
  exit 1
fi
install -m 755 "${sonar_tmp}/sonar" /usr/local/bin/sonar
rm -rf "${sonar_tmp}"
echo "sonar CLI ${SONAR_CLI_VERSION}: signature OK"

# jdtls (Eclipse JDT Language Server) milestone release. `latest` picks the
# newest milestone; pin one (e.g. 1.50.0) with the JDTLS_VERSION build arg.
#
# The official tarball only lives on download.eclipse.org (mirrors don't
# carry jdtls), and that host has been seen answering every path with a 200
# "Temporary shutdown" HTML page. So a download only counts once it matches
# the .sha256 Eclipse publishes beside it, and when Eclipse has nothing
# usable the same tarball is taken from Homebrew's architecture-independent
# bottle on ghcr.io instead, verified against the sha256 in Homebrew's
# formula.
jdtls_from_eclipse() {
  local archive="$1"
  local milestones="https://download.eclipse.org/jdtls/milestones"
  local version="${JDTLS_VERSION}" file sha
  if [[ "${version}" == "${LATEST}" ]]; then
    version="$(fetch "${milestones}/" \
      | grep -oE '[0-9]+\.[0-9]+\.[0-9]+/' | tr -d / | sort -uV | tail -n 1)"
  fi
  [[ -n "${version}" ]] || return 1
  file="$(fetch "${milestones}/${version}/latest.txt" | tr -d '[:space:]')"
  [[ "${file}" =~ ^jdt-language-server-.*\.tar\.gz$ ]] || return 1
  fetch "${milestones}/${version}/${file}" -o "${archive}"
  sha="$(fetch "${milestones}/${version}/${file}.sha256" | grep -oE '^[0-9a-f]{64}')"
  [[ -n "${sha}" ]] || return 1
  echo "${sha}  ${archive}" | sha256sum -c --quiet - || return 1
  echo "jdtls ${version}: ${milestones}/${version}/${file}"
}

# The bottle wraps the tarball's contents in jdtls/<version>/libexec/, so
# this repacks that directory into a plain tarball for the common path.
jdtls_from_homebrew() {
  local archive="$1"
  local formula version sha bottle unpacked libexec
  formula="$(fetch https://raw.githubusercontent.com/Homebrew/homebrew-core/main/Formula/j/jdtls.rb)"
  version="$(grep -oE '^  version "[^"]+"' <<<"${formula}" | cut -d'"' -f2)"
  sha="$(grep -oE 'all: "[0-9a-f]{64}"' <<<"${formula}" | grep -oE '[0-9a-f]{64}')"
  [[ -n "${version}" && -n "${sha}" ]] || return 1
  if [[ "${JDTLS_VERSION}" != "${LATEST}" && "${JDTLS_VERSION}" != "${version}" ]]; then
    echo "jdtls: Homebrew only has ${version}, not ${JDTLS_VERSION}" >&2
    return 1
  fi
  bottle="$(mktemp)"
  unpacked="$(mktemp -d)"
  fetch -H "Authorization: Bearer QQ==" \
    "https://ghcr.io/v2/homebrew/core/jdtls/blobs/sha256:${sha}" -o "${bottle}"
  echo "${sha}  ${bottle}" | sha256sum -c --quiet - || return 1
  tar -xzf "${bottle}" -C "${unpacked}"
  # The directory is <version>_<revision> when the formula has a revision.
  libexec="$(echo "${unpacked}"/jdtls/*/libexec)"
  [[ -d "${libexec}" ]] || return 1
  tar -czf "${archive}" -C "${libexec}" .
  rm -rf "${bottle}" "${unpacked}"
  echo "jdtls ${version}: Homebrew bottle sha256:${sha}"
}

jdtls_archive="$(mktemp)"
if ! jdtls_from_eclipse "${jdtls_archive}"; then
  echo "jdtls: no usable download from download.eclipse.org, trying Homebrew" >&2
  jdtls_from_homebrew "${jdtls_archive}"
fi
mkdir -p /opt/jdtls
tar -xzf "${jdtls_archive}" -C /opt/jdtls
rm -f "${jdtls_archive}"
# Run the launcher through python3 rather than its shebang, which the
# Homebrew bottle rewrites to a Homebrew-prefixed interpreter.
cat >/usr/local/bin/jdtls <<'WRAPPER'
#!/bin/sh
exec python3 /opt/jdtls/bin/jdtls "$@"
WRAPPER
chmod 755 /usr/local/bin/jdtls
