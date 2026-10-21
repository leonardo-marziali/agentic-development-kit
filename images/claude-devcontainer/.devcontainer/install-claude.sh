#!/usr/bin/env bash
# Installs Claude Code's native build for the current (non-root) user, into
# ~/.local/bin. Does what https://claude.ai/install.sh does, minus piping a
# remote script into bash: the binary is downloaded over HTTPS only and must
# match the sha256 in the release manifest before it runs.
set -euo pipefail

CLAUDE_VERSION="${CLAUDE_VERSION:-stable}"
RELEASES="https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases"

fetch() {
  curl --proto '=https' --tlsv1.2 -fsSL "$@"
}

case "$(uname -m)" in
  x86_64 | amd64) platform="linux-x64" ;;
  aarch64 | arm64) platform="linux-arm64" ;;
  *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

version="${CLAUDE_VERSION}"
if [[ "${version}" == "stable" || "${version}" == "latest" ]]; then
  version="$(fetch "${RELEASES}/${version}" | tr -d '[:space:]')"
fi

checksum="$(fetch "${RELEASES}/${version}/manifest.json" \
  | jq -r --arg p "${platform}" '.platforms[$p].checksum // empty')"
if [[ ! "${checksum}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "claude: no checksum for ${platform} in the ${version} manifest" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
fetch "${RELEASES}/${version}/${platform}/claude" -o "${tmp}/claude"
echo "${checksum}  ${tmp}/claude" | sha256sum -c --quiet -
chmod 755 "${tmp}/claude"
"${tmp}/claude" install "${version}"
echo "claude ${version}: sha256 OK"
