# claude-devcontainer

A [dev container](https://containers.dev/) image with Claude Code, every
plugin in this repository's marketplace, a set of third-party plugins, and
the tooling all of them shell out to — so a project only needs one line of
`devcontainer.json` to get the whole setup.

Published to GitHub Container Registry by
[`devcontainer-image.yml`](../../.github/workflows/devcontainer-image.yml):

```text
ghcr.io/leonardo-marziali/claude-devcontainer:latest       newest build
ghcr.io/leonardo-marziali/claude-devcontainer:YYYYMMDD     date of build
ghcr.io/leonardo-marziali/claude-devcontainer:sha-<commit> commit it was built from
```

Built for `linux/amd64` and `linux/arm64`, on every push to `main` that
touches this directory, weekly (to pick up new Claude Code, plugin and LSP
releases), and on demand from the Actions tab.

## Usage

In another project, create `.devcontainer/devcontainer.json`:

```json
{
  "name": "my-project",
  "image": "ghcr.io/leonardo-marziali/claude-devcontainer:latest",
  "remoteEnv": {
    "GITHUB_PERSONAL_ACCESS_TOKEN": "${localEnv:GITHUB_PERSONAL_ACCESS_TOKEN}",
    "SONARQUBE_TOKEN": "${localEnv:SONARQUBE_TOKEN}",
    "SONARQUBE_URL": "${localEnv:SONARQUBE_URL}"
  }
}
```

The image already carries its dev container settings (remote user `node`,
the docker-outside-of-docker and GitHub CLI features, the Claude Code VS
Code extension) in its metadata label, so nothing else is required. The
`remoteEnv` entries are optional — forward only the ones you use:

- `GITHUB_PERSONAL_ACCESS_TOKEN` — the `github@claude-plugins-official`
  MCP server.
- `SONARQUBE_TOKEN`, `SONARQUBE_URL` — the `sonarqube` plugin's MCP server.

### Keeping the login

Log in once with `claude auth login` in a container terminal. To keep the
login, add a setting — this repository's own
[`.devcontainer/devcontainer.json`](../../.devcontainer/devcontainer.json)
uses it:

- **Persist your login.** Rebuilding the container discards `~/.claude`,
  and with it the login. Mount a named volume there:

  ```json
  "mounts": ["source=claude-config,target=/home/node/.claude,type=volume"]
  ```

  Docker seeds an empty volume from the image's `~/.claude` on first use,
  so the baked-in plugins carry over. After that the volume wins: a newer
  image's plugin set only reaches it through `claude plugin install` /
  `claude plugin update`, or by removing the volume
  (`docker volume rm claude-config`) and logging in again.

## What's inside

### Plugins (user scope, enabled)

- `leonardo-marziali/agentic-development-kit`: `markdown`, `prettier`,
  `python`, `sonarqube`, `git`, `github`
- `anthropics/claude-plugins-official`: `jdtls-lsp`, `pyright-lsp`,
  `typescript-lsp`, `skill-creator`, `claude-code-setup`, plus `github`
  (a dependency of `github@agentic-development-kit`; `pyright-lsp` is
  likewise a dependency of `python@agentic-development-kit`)
- `obra/superpowers-marketplace`: `superpowers`
- `upstash/context7`: `context7`

The marketplaces are registered from GitHub, so `claude plugin update`
works inside the container. The list lives in
[`install-plugins.sh`](.devcontainer/install-plugins.sh).

### Tooling

| Tool                                       | Needed by               |
| ------------------------------------------ | ----------------------- |
| Node.js 24 (base image)                    | every plugin with hooks |
| `marksman`, `markdownlint-cli`             | `markdown`              |
| `prettier`                                 | `prettier`              |
| `ruff`, `pyright`                          | `python`                |
| `sonar` CLI, `docker` CLI (host socket)    | `sonarqube`             |
| `gh`                                       | `github`                |
| OpenJDK 21, `jdtls`                        | `jdtls-lsp`             |
| `pyright`                                  | `pyright-lsp`           |
| `typescript`, `typescript-language-server` | `typescript-lsp`        |
| Python 3 + PyYAML                          | `skill-creator` scripts |

The `docker` CLI talks to the host's Docker daemon (docker-outside-of-docker),
which is what the SonarQube MCP server container runs on.

## Building locally

```sh
npx @devcontainers/cli build \
  --workspace-folder images/claude-devcontainer \
  --image-name claude-devcontainer:dev
```

Build args in [`devcontainer.json`](.devcontainer/devcontainer.json) pin
each downloaded tool (all default to the newest release):

- `CLAUDE_VERSION` — `stable`, `latest`, or a version such as `2.1.304`
- `JDTLS_VERSION` — a jdtls milestone such as `1.63.0`
- `MARKSMAN_VERSION` — a marksman release tag
- `SONAR_CLI_VERSION` — a SonarQube CLI version such as `1.10.0.16040`
- `RUFF_VERSION` — a ruff release on PyPI such as `0.17.1`
- `MARKETPLACE_REF` — the git ref of this repository's marketplace to
  install plugins from (empty: the default branch). Pull request builds
  set it to the PR's branch, so a newly added plugin can be installed
  before it is merged.

Every download is HTTPS-only and verified before it is installed or run:
Claude Code against the sha256 in its release manifest, ruff against the
sha256 PyPI's index publishes for each wheel, the SonarQube CLI
against SonarSource's OpenPGP signature (key in
[`sonarsource.asc`](.devcontainer/sonarsource.asc), fingerprint pinned in
`install-tools.sh`), and jdtls against the sha256 Eclipse publishes. While
download.eclipse.org is down, jdtls comes from Homebrew's bottle of the
same release instead, checked against the sha256 in Homebrew's formula.

## First publish

GHCR creates the package as **private** the first time the workflow
pushes it. To pull it from other machines without logging in, open the
package on GitHub (_Packages_ → `claude-devcontainer` → _Package settings_)
and change its visibility to public.
