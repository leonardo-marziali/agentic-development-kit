#!/usr/bin/env bash
# System-wide tooling the baked-in plugins shell out to. Runs as root.
#
#   plugin                      needs
#   markdown                    marksman (LSP), markdownlint-cli (via npx)
#   prettier                    prettier (via npx)
#   sonarqube                   sonar CLI (installed per-user, see Dockerfile),
#                               docker CLI (devcontainer feature)
#   github                      gh CLI (devcontainer feature)
#   jdtls-lsp                   jdtls + JDK 21
#   pyright-lsp                 pyright-langserver
#   typescript-lsp              typescript-language-server + typescript
#   skill-creator               python3 + PyYAML
#   all plugins with hooks      node (base image)
set -euo pipefail

JDTLS_VERSION="${JDTLS_VERSION:-latest}"
MARKSMAN_VERSION="${MARKSMAN_VERSION:-latest}"

case "$(uname -m)" in
  x86_64 | amd64) MARKSMAN_ARCH="x64" ;;
  aarch64 | arm64) MARKSMAN_ARCH="arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl git jq ripgrep unzip \
  openjdk-21-jdk-headless \
  python3 python3-pip python3-venv python3-yaml
rm -rf /var/lib/apt/lists/*

# Node-based CLIs. Installed globally so the hooks' `npx -y <tool>` resolves
# them locally instead of downloading on first use.
npm install -g \
  markdownlint-cli \
  prettier \
  pyright \
  typescript \
  typescript-language-server
npm cache clean --force

# marksman (markdown LSP)
if [ "${MARKSMAN_VERSION}" = "latest" ]; then
  marksman_url="https://github.com/artempyanykh/marksman/releases/latest/download/marksman-linux-${MARKSMAN_ARCH}"
else
  marksman_url="https://github.com/artempyanykh/marksman/releases/download/${MARKSMAN_VERSION}/marksman-linux-${MARKSMAN_ARCH}"
fi
curl -fsSL "${marksman_url}" -o /usr/local/bin/marksman
chmod +x /usr/local/bin/marksman

# jdtls (Eclipse JDT Language Server) milestone release. `latest` picks the
# newest milestone; pin one (e.g. 1.50.0) with the JDTLS_VERSION build arg.
#
# The official tarball only lives on download.eclipse.org (mirrors don't
# carry jdtls), and that host has been seen answering every path with a 200
# "Temporary shutdown" HTML page. So a download only counts once it passes
# `gzip -t`, and when Eclipse has nothing usable the same tarball is taken
# from Homebrew's architecture-independent bottle on ghcr.io instead,
# verified against the sha256 in Homebrew's formula.
jdtls_from_eclipse() {
  local milestones="https://download.eclipse.org/jdtls/milestones"
  local version="${JDTLS_VERSION}" file
  if [ "${version}" = "latest" ]; then
    version="$(curl -fsSL "${milestones}/" \
      | grep -oE '[0-9]+\.[0-9]+\.[0-9]+/' | tr -d / | sort -uV | tail -n 1)"
  fi
  [ -n "${version}" ] || return 1
  file="$(curl -fsSL "${milestones}/${version}/latest.txt" | tr -d '[:space:]')"
  [[ "${file}" =~ ^jdt-language-server-.*\.tar\.gz$ ]] || return 1
  curl -fsSL "${milestones}/${version}/${file}" -o "$1"
  gzip -t "$1" 2>/dev/null || return 1
  echo "jdtls ${version}: ${milestones}/${version}/${file}"
}

# The bottle wraps the tarball's contents in jdtls/<version>/libexec/, so
# this repacks that directory into a plain tarball for the common path.
jdtls_from_homebrew() {
  local formula version sha bottle unpacked libexec
  formula="$(curl -fsSL https://raw.githubusercontent.com/Homebrew/homebrew-core/main/Formula/j/jdtls.rb)"
  version="$(grep -oE '^  version "[^"]+"' <<<"${formula}" | cut -d'"' -f2)"
  sha="$(grep -oE 'all: "[0-9a-f]{64}"' <<<"${formula}" | grep -oE '[0-9a-f]{64}')"
  [ -n "${version}" ] && [ -n "${sha}" ] || return 1
  if [ "${JDTLS_VERSION}" != "latest" ] && [ "${JDTLS_VERSION}" != "${version}" ]; then
    echo "jdtls: Homebrew only has ${version}, not ${JDTLS_VERSION}" >&2
    return 1
  fi
  bottle="$(mktemp)"
  unpacked="$(mktemp -d)"
  curl -fsSL -H "Authorization: Bearer QQ==" \
    "https://ghcr.io/v2/homebrew/core/jdtls/blobs/sha256:${sha}" -o "${bottle}"
  echo "${sha}  ${bottle}" | sha256sum -c --quiet - || return 1
  tar -xzf "${bottle}" -C "${unpacked}"
  # The directory is <version>_<revision> when the formula has a revision.
  libexec="$(echo "${unpacked}"/jdtls/*/libexec)"
  [ -d "${libexec}" ] || return 1
  tar -czf "$1" -C "${libexec}" .
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
chmod +x /usr/local/bin/jdtls
