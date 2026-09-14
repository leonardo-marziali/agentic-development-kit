# SonarQube

[![sonarqube plugin coverage](https://codecov.io/gh/leonardo-marziali/agentic-development-kit/branch/main/graph/badge.svg?flag=sonarqube-plugin)](https://codecov.io/gh/leonardo-marziali/agentic-development-kit)

Plugin that keeps a session from ending while the files it touched still
contain secrets or SonarQube findings, and embeds the official SonarQube
MCP server for server-side issue triage.

## Requirements

Both are prerequisites. This plugin does **not** install either, and
deliberately gives no install instructions — how you get them is your
platform's business, not the plugin's.

- **The [SonarQube CLI][cli] (`sonar`)**, for the hooks. If it isn't
  found, every hook no-ops with a single note on stderr — a missing
  optional tool never blocks a session.
- **A container runtime**, for the MCP server, which runs as a container.
  Docker Desktop is not required — see below.

[cli]: https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/sonarqube-cli/

### Container runtime

Any Docker-compatible runtime works. These all provide a `docker` CLI, so
the plugin uses them with **no configuration at all**:

- **Docker Desktop** (Mac, Windows, Linux) — the default assumption.
- **OrbStack** (Mac) — fast and light; starts quicker and uses less
  RAM/CPU than Docker Desktop. Free for personal use, paid for commercial
  use at larger companies.
- **Colima** (Mac, Linux) — command-line only, no GUI, Lima underneath.
  Fully open source with no licensing restrictions.
- **Rancher Desktop** (Mac, Windows, Linux) — open source, backed by
  SUSE. Has a GUI, switches between containerd and dockerd as the
  runtime, and bundles Kubernetes.
- **Lima** (Mac, Linux) — the VM layer Colima and others build on. CLI
  only, more DIY.

**Podman** takes one extra step. It is daemonless and rootless by
default — a different security model — and its CLI is `podman`, not
`docker`. Install its `docker` shim (the `podman-docker` package on
Linux; on macOS, Podman Desktop can provide the alias) and everything
below applies unchanged.

The plugin invokes `docker` directly rather than offering a setting for
this. Every runtime above already answers to that name, so a setting
would be configuration surface that only one runtime ever uses — and
which its own shim already solves.

The image is referenced as `docker.io/sonarsource/sonarqube-mcp` rather
than by short name. Podman has no implicit Docker Hub default, so a short
name would either consult `unqualified-search-registries` or prompt — and
a prompt on a stdio server hangs the connection. Docker ignores the
prefix.

### Credentials

The MCP server also needs two environment variables:

| Variable          | Value                                       |
| ----------------- | ------------------------------------------- |
| `SONARQUBE_TOKEN` | A user token for your instance              |
| `SONARQUBE_URL`   | Your Server URL, or `https://sonarcloud.io` |

The token is read from your environment — never stored in the plugin —
and reaches the container as a bare `-e SONARQUBE_TOKEN`, so it never
appears in the container's argument list.

The hooks need neither variable. They use whatever credentials the CLI
already has, including a session persisted by `sonar auth login`.

They do need the CLI to _have_ credentials, though. `sonar analyze`
refuses to run at all when none are configured, exiting 1 before it scans
anything — **including the secrets stage**. An unauthenticated CLI
therefore means the session isn't being gated, which the hook says
loudly on stderr rather than passing over in silence.

## What This Plugin Provides

### Validation hooks

- **Session-scoped analysis**: only files created or edited _during the
  current session_ get analysed. Pre-existing code is left alone unless
  you ask for it (see [`/sonarqube:analyze`](#skills) below).
- A `PostToolUse` hook (on `Edit`/`Write`) records every file the session
  touches. There is no language or extension filter — Sonar decides what
  it supports, and a leaked credential is worth finding whatever file it
  is in.
- **Scope follows git**, the way SonarQube for IDE does: a file the
  repository ignores is not this project's source and is not analysed.
  `.gitignore` already says precisely what a project treats as generated
  or vendored, it's maintained by the people who own the repo, and it
  covers what a hardcoded list of directory names always misses — a
  `target/`, a `.next/`, a project-specific output folder nobody else
  would think to name. The question asked is "is this ignored?", not "is
  it tracked?", so a file Claude has just created is still in scope.
  Outside any git repository there is no such statement to read, and a
  heuristic list of the usual generated and vendored directory names
  applies instead.
- `Stop` and `SubagentStop` hooks then run two stages over that set:

  1. **Secrets** (`sonar analyze secrets`) — the scan itself is local, so
     no code leaves your machine and an unreachable server can't make it
     flaky. Always runs, and findings always block.
  2. **Full analysis** (`sonar analyze --file …`) — always _attempted_,
     never gated on environment variables, so an already-authenticated
     CLI is used as-is. Findings block; an unauthenticated CLI or an
     unreachable server is reported on stderr and does **not** block.

- **Autonomous fix loop**: when something is found, the `Stop` hook
  blocks the session from ending and hands Claude the findings, so it
  keeps working on them. Up to 3 attempts per session.
- **Nothing is ever written to your files.** Unlike the sibling
  `markdown` plugin, there is no auto-suppression at the attempt cap: the
  remaining findings are reported and the session ends. Auto-inserting
  `NOSONAR` comments would quietly bury exactly the findings this plugin
  exists to surface, and a secret must never be suppressible by a hook.
- Once the session's files are clean (or the cap is hit), the tracked
  file list is cleared.

#### Connected mode

`sonar analyze` takes project context from its own working directory, so
the hooks group the session's files by their nearest
`.sonarlint/connectedMode.json` and run the CLI once per group — from
that directory, with that group's `--project`. A monorepo with two bound
sub-projects gets two correctly-scoped runs. Files with no binding above
them form one group, analysed without `--project`.

### MCP server

The plugin ships `.mcp.json`, so installing it registers the official
`sonarsource/sonarqube-mcp` server (stdio, via your container runtime)
without any further setup. See [Toolsets](#toolsets) for exactly what it
exposes.

### Skills

#### Analysis

- **analyze** (`/sonarqube:analyze [path]`): explicitly run SonarQube
  over `path` (or the project) — including files this session never
  touched. This is the deliberate escape hatch for scanning pre-existing
  code. Manual invocation only; Claude won't trigger it on its own.

#### Knowledge

- **sonarqube-connected-mode**: `.sonarlint/connectedMode.json` — its
  shape, how the nearest binding is resolved, monorepos, and what to do
  when there is no binding.
- **sonarqube-issue-triage**: what to fix first, handling a detected
  secret, telling a real defect from a false positive, quality gates, and
  when a suppression is ever justified.
- **sonarqube-mcp-usage**: the MCP server's enabled and disabled
  toolsets, and how to work with it.

#### Naming convention

Skill names are prefixed with the most specific subject they document,
not mechanically with the plugin name. Knowledge skills here all concern
SonarQube itself, so they take the `sonarqube-` prefix; the
user-invocable skill gets a short verb name with no prefix (`analyze`).

## Toolsets

`SONARQUBE_TOOLSETS` is set explicitly in `.mcp.json`, so the server's
surface is exactly the following — documented here so the boundaries are
visible without reading the vendor docs.

### Enabled

| Toolset           | What it does                                      |
| ----------------- | ------------------------------------------------- |
| Analysis          | Run analyzers on a snippet or file content        |
| IDE               | Bridge to a running SonarQube for IDE instance    |
| Projects          | Find projects, discover branches and PRs          |
| Issues            | Search issues, change status (resolve, won't-fix) |
| Security hotspots | Search and review security-sensitive code         |
| Quality gates     | List gates, check a project's pass/fail           |
| Rules             | Details and rationale for a rule                  |
| Duplications      | Find duplicated blocks                            |
| Measures          | LOC, complexity, coverage %, violation counts     |
| Dependency risks  | SCA findings (see tier note below)                |
| Coverage          | Line-by-line detail, under-covered file discovery |
| Agentic readiness | Vortex tooling for code that passes analysis      |
| Sources           | Raw source and SCM blame info                     |
| Languages         | Languages the instance supports                   |
| Portfolios        | Browse portfolios (Enterprise tier)               |

Three of those have their own requirements beyond being enabled:

- **Dependency risks** needs SonarQube Server 2025.4 Enterprise+ with
  Advanced Security, or the SonarQube Cloud equivalent.
- **Sources** needs the "See Source Code" permission.
- **Portfolios** needs the Enterprise tier.

### Disabled

| Toolset        | Why it's off                                  |
| -------------- | --------------------------------------------- |
| Vortex context | Cloud-only; needs a Vortex entitlement        |
| Vortex         | Unified toolset for Vortex-entitled orgs      |
| System         | ping/status/health/logs; some need Administer |
| Webhooks       | Create/list webhooks; requires Administer     |

### Advanced options — all disabled

- **Debug logging.**
- **Read-only mode** — would restrict the server to read-only tools,
  disabling issue-status changes and webhook creation.
- **Custom SSL CA certificate** — for internally-signed TLS.

### Other settings — unset

- **No default project key.** `SONARQUBE_PROJECT_KEY` is not pre-filled,
  so `projectKey` must be given per request. In practice it comes from
  `.sonarlint/connectedMode.json`.
- **No workspace mount / host path.** Only `run_advanced_code_analysis`
  and the Vortex context tools need it, and both are off — so leaving it
  unset is consistent, not an oversight.

## Installation

Add this repository as a plugin marketplace in Claude Code and install
the `sonarqube` plugin from it, or copy the `plugins/sonarqube`
directory into your own plugin setup.

## Usage

Once installed, the plugin analyses files **this session created or
edited**:

- When you finish a conversation with Claude Code (looping on remaining
  findings, up to 3 attempts, before giving up)
- When Claude Code agents complete their work

Pre-existing code is never touched by these hooks. Run
`/sonarqube:analyze [path]` to scan it explicitly.

### Options

The plugin declares two options, prompted when you enable it and
changeable later from the plugin's configuration:

**`analysis_depth`** — `STANDARD` (default) or `DEEP`.

Passed to `sonar analyze` as `--depth`. `DEEP` analyses more thoroughly
and takes noticeably longer; the `Stop` hook runs under a 180-second
timeout, so `STANDARD` is the safer choice on large changesets.

**`block_on`** — `secrets-and-issues` (default) or `secrets`.

Which findings stop the session from ending. `secrets` runs only the
local secrets scan, which is fast and sends no code anywhere.
`secrets-and-issues` also runs the full analysis and blocks on its
findings too.

Secrets always block, under either setting. That is the point of the
plugin, and there is no option to turn it off.

### Authentication

The hooks never inspect environment variables to decide whether to run
the full analysis; they attempt it and read the exit code. So a CLI
authenticated with:

```bash
sonar auth login -s https://sonarqube.example.com
```

works with nothing else configured. `SONARQUBE_CLI_TOKEN` /
`SONARQUBE_CLI_ORG` work too, if you prefer them.

If neither is set up, the CLI exits 1 for **both** stages — it declines to
analyse anything at all without credentials — and the hook says so on
stderr without blocking. Nothing is gated in that state, so the note for
the secrets stage spells that out explicitly rather than letting a silent
session read as a clean one.

(Verified against CLI 1.7.0: the secrets scan makes no server call — it
still reports findings with an unreachable server configured — but the
CLI does require credentials to be present before it will run.)

## Testing

The hooks (`scripts/hooks/*.js`) have a versioned test suite under
`scripts/hooks/__tests__/`, using Node's built-in test runner. The hooks'
one runtime dependency, `@leonardo-marziali/ad-lfl-kit`, is pinned in
`package-lock.json`; install it with `npm ci` first — the same install
Claude Code runs when it caches the plugin.

```bash
cd plugins/sonarqube
npm ci
pnpm test
```

The suite does **not** require the `sonar` CLI. It runs the hooks against
a stand-in executable that logs its argv and cwd, so the tests still
assert the real contract — which subcommand ran, with which `--project`,
from which directory — while staying runnable anywhere. Covered: session
scoping, both analysis stages, every documented exit code, the 3-attempt
cap (and that it writes nothing to your files), both plugin options, and
connected-mode binding resolution including monorepos.

Coverage uses Node's built-in test-runner coverage (no extra dependency):

```bash
pnpm test:coverage
```

This writes `coverage/lcov.info`, which the
[Plugin Tests](../../.github/workflows/plugin-tests.yml) GitHub Actions
workflow uploads to Codecov on every pull request that touches this
plugin — that's what the badge above reflects.
