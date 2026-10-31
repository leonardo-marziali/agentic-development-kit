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
    "SONARQUBE_CLI_TOKEN": "${localEnv:SONARQUBE_CLI_TOKEN}",
    "SONARQUBE_CLI_SERVER": "${localEnv:SONARQUBE_CLI_SERVER}",
    "SONARQUBE_CLI_ORG": "${localEnv:SONARQUBE_CLI_ORG}"
  }
}
```

The image already carries its dev container settings (remote user `node`,
the docker-outside-of-docker and GitHub CLI features, the Claude Code VS
Code extension) in its metadata label, so nothing else is required. The
`remoteEnv` entries are optional — forward only the ones you use:

- `GITHUB_PERSONAL_ACCESS_TOKEN` — the `github@claude-plugins-official`
  MCP server, and the `gh` CLI login (see
  [GitHub CLI login](#github-cli-login)).
- `SONARQUBE_CLI_TOKEN`, `SONARQUBE_CLI_SERVER`, `SONARQUBE_CLI_ORG` — the
  SonarQube CLI's connection to SonarQube Server or Cloud, which the
  `sonarqube` plugin reads through `sonar api`. `SONARQUBE_CLI_ORG` is for
  Cloud only.

### GitHub CLI login

`gh` only reads `GH_TOKEN` / `GITHUB_TOKEN`, so on its own it stays logged
out even when `GITHUB_PERSONAL_ACCESS_TOKEN` is set. On every start the
container runs `gh-login`
([`gh-login.sh`](.devcontainer/gh-login.sh)), which pipes that token into
`gh auth login --with-token` and runs `gh auth setup-git`, so `git push`
over HTTPS uses the same token. Check with `gh auth status`.

It needs no configuration beyond the token reaching the container —
through `remoteEnv` as above, `containerEnv`, or
`"runArgs": ["--env-file", "${localWorkspaceFolder}/.env"]`. It does
nothing when the token is unset or `gh` is already logged in, clears
`GH_TOKEN` / `GITHUB_TOKEN` for the login call (`gh auth login` refuses to
run while either is set), and never fails the container start. The token
scopes `gh` needs are listed in the root README's
[GitHub token](../../README.md#github-token) section.

### Claude Code attribution

Claude Code adds a `Co-Authored-By: Claude ...` trailer to commits and a
"Generated with Claude Code" footer to pull request descriptions. To turn
that off, set `CLAUDE_ATTRIBUTION` to `false` in your `devcontainer.json`:

```json
"containerEnv": { "CLAUDE_ATTRIBUTION": "false" }
```

On every start the container writes
`"attribution": { "commit": "", "pr": "", "sessionUrl": false }` to
`~/.claude/settings.json`, leaving the rest of the file alone. `true`
removes that key again, restoring Claude Code's defaults; leaving the
variable unset never touches the file. `claude-attribution --status` shows
the current state, and `--enable` / `--disable` toggle it by hand.

### LLM Wiki

The image ships the [`llm-wiki`](https://github.com/leonardo-marziali/llm-wiki)
`wiki` CLI and its read-only `wiki-lookup` skill, which Claude Code uses to
answer from a wiki's cited pages. To make one of your wikis available in
the container, add this to your `devcontainer.json`:

```json
"runArgs": ["-v", "${localEnv:LLM_WIKI_HOST_PATH:llm-wiki-none}:/home/node/llm-wiki"]
```

and set `LLM_WIKI_HOST_PATH` on the host to the wiki's root (the directory
holding `wiki.toml`, created with `wiki init`):

```sh
export LLM_WIKI_HOST_PATH="$HOME/wikis/payments"
```

- **It is optional.** When the variable is unset, the fallback name
  `llm-wiki-none` makes Docker mount an empty named volume instead of
  failing to start. The CLI skips it because it holds no `wiki.toml`.
  Leave it unset rather than empty: `LLM_WIKI_HOST_PATH=` skips the
  fallback and Docker rejects the resulting `-v :/home/node/llm-wiki`.
- **It is read on the host.** `${localEnv:...}` comes from the environment
  VS Code or the dev container CLI was started from, so put it in your shell
  profile. An `--env-file` such as `.env` only sets variables inside the
  container and does not work here. Rebuild the container after changing
  it.
- **How the CLI finds it.** The image sets
  `LLM_WIKI_PATH=/home/node/llm-wiki`, so `wiki status --all` (the skill's
  first step) lists the mounted wiki without any registration. Check with
  `wiki status --all` in a container terminal.
- **It is writable,** so `wiki ingest` works in the container. Ingest runs
  headless Claude Code, which needs `claude auth login`, and commits to the
  wiki, which needs git `user.name` and `user.email`. The image marks the
  mount point as a git `safe.directory`, so a wiki owned by a different host
  UID is accepted. For lookups only, append `:ro` to the mount.
- **Mount the wiki's own repository.** git cannot see a parent repository
  outside the mount, so a wiki kept as a folder inside a bigger repository
  can be read and searched, but `wiki ingest` will not work on it.

`wiki skill install` runs at build time and on every start, so the skill
stays in step with the image's CLI even when `~/.claude` is a persisted
volume. It never fails the start.

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

Plus the user-level `wiki-lookup` skill from `llm-wiki` (see
[LLM Wiki](#llm-wiki)).

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
| `wiki` (`llm-wiki-tool`)                   | `wiki-lookup` skill     |

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
- `LLM_WIKI_VERSION` — an `llm-wiki-tool` release on PyPI such as `0.1.1`
- `MARKETPLACE_REF` — the git ref of this repository's marketplace to
  install plugins from (empty: the default branch). Pull request builds
  set it to the PR's branch, so a newly added plugin can be installed
  before it is merged.

Every download is HTTPS-only and verified before it is installed or run:
Claude Code against the sha256 in its release manifest, ruff and
`llm-wiki-tool` (with its dependencies) against the sha256 PyPI's index
publishes for each wheel, the SonarQube CLI
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
