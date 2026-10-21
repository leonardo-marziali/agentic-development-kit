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
# download.eclipse.org has been seen answering every path with a 200
# "Temporary shutdown" HTML page, so each Eclipse mirror is tried in turn
# and a download only counts once it is a valid gzip archive.
JDTLS_MIRRORS=(
  "https://download.eclipse.org"
  "https://ftp.fau.de/eclipse"
  "https://ftp.osuosl.org/pub/eclipse"
  "https://mirror.dkm.cz/eclipse"
)

# Prints the tarball URL for JDTLS_VERSION on one mirror, or fails.
jdtls_tarball_url() {
  local milestones="$1/jdtls/milestones" version file
  version="${JDTLS_VERSION}"
  if [ "${version}" = "latest" ]; then
    version="$(curl -fsSL "${milestones}/" \
      | grep -oE '[0-9]+\.[0-9]+\.[0-9]+/' | tr -d / | sort -uV | tail -n 1)"
  fi
  [ -n "${version}" ] || return 1
  file="$(curl -fsSL "${milestones}/${version}/latest.txt" | tr -d '[:space:]')" || file=""
  if [[ ! "${file}" =~ ^jdt-language-server-.*\.tar\.gz$ ]]; then
    file="$(curl -fsSL "${milestones}/${version}/" \
      | grep -oE 'jdt-language-server-[0-9.]+-[0-9]+\.tar\.gz' | sort -uV | tail -n 1)"
  fi
  [ -n "${file}" ] || return 1
  echo "${milestones}/${version}/${file}"
}

jdtls_archive="$(mktemp)"
jdtls_ok=""
for mirror in "${JDTLS_MIRRORS[@]}"; do
  if url="$(jdtls_tarball_url "${mirror}")" \
    && curl -fsSL "${url}" -o "${jdtls_archive}" \
    && gzip -t "${jdtls_archive}" 2>/dev/null; then
    echo "jdtls: ${url}"
    jdtls_ok=1
    break
  fi
  echo "jdtls: no usable download from ${mirror}" >&2
done
if [ -z "${jdtls_ok}" ]; then
  echo "jdtls: every mirror failed" >&2
  exit 1
fi
mkdir -p /opt/jdtls
tar -xzf "${jdtls_archive}" -C /opt/jdtls
rm -f "${jdtls_archive}"
ln -sf /opt/jdtls/bin/jdtls /usr/local/bin/jdtls
