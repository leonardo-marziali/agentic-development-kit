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
    "CLAUDE_CODE_OAUTH_TOKEN": "${localEnv:CLAUDE_CODE_OAUTH_TOKEN}",
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

- `CLAUDE_CODE_OAUTH_TOKEN` — Claude Code login, created with
  `claude setup-token` (or forward `ANTHROPIC_API_KEY` instead, or just run
  `claude` in the container and log in interactively).
- `GITHUB_PERSONAL_ACCESS_TOKEN` — the `github@claude-plugins-official`
  MCP server.
- `SONARQUBE_TOKEN`, `SONARQUBE_URL` — the `sonarqube` plugin's MCP server.

## What's inside

### Plugins (user scope, enabled)

- `leonardo-marziali/agentic-development-kit`: `markdown`, `prettier`,
  `sonarqube`, `git`, `github`
- `anthropics/claude-plugins-official`: `jdtls-lsp`, `pyright-lsp`,
  `typescript-lsp`, `skill-creator`, `claude-code-setup`, plus `github`
  (a dependency of `github@agentic-development-kit`)
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

Build args `JDTLS_VERSION` (default `latest`, the newest milestone; or a
specific milestone such as `1.50.0`, fetched from download.eclipse.org or,
failing that, an Eclipse mirror) and `MARKSMAN_VERSION` (default `latest`, or a
release tag) pin those tools; set them under `build.args` in
[`devcontainer.json`](.devcontainer/devcontainer.json).

## First publish

GHCR creates the package as **private** the first time the workflow
pushes it. To pull it from other machines without logging in, open the
package on GitHub (_Packages_ → `claude-devcontainer` → _Package settings_)
and change its visibility to public.
