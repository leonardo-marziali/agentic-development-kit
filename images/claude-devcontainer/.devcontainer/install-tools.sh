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

# jdtls (Eclipse JDT Language Server). `latest` follows the snapshot
# channel; pin a milestone (e.g. 1.50.0) with the JDTLS_VERSION build arg.
if [ "${JDTLS_VERSION}" = "latest" ]; then
  jdtls_base="https://download.eclipse.org/jdtls/snapshots"
else
  jdtls_base="https://download.eclipse.org/jdtls/milestones/${JDTLS_VERSION}"
fi
jdtls_file="$(curl -fsSL "${jdtls_base}/latest.txt" | tr -d '[:space:]')"
mkdir -p /opt/jdtls
curl -fsSL "${jdtls_base}/${jdtls_file}" | tar -xz -C /opt/jdtls
ln -sf /opt/jdtls/bin/jdtls /usr/local/bin/jdtls
