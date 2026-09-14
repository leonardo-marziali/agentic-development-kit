---
name: sonarqube-mcp-usage
user-invocable: false
description: Use when working with the SonarQube MCP server's tools — searching issues or security hotspots, checking a quality gate, reading rule rationale, pulling measures or coverage, or figuring out why an expected SonarQube tool isn't available. Covers exactly which toolsets this plugin enables and which it leaves off.
---

# SonarQube MCP Usage

This plugin embeds the official SonarQube MCP server (`.mcp.json`), run as
a stdio server in Docker. It gives you read and triage access to a
SonarQube Server or SonarQube Cloud instance from inside a session.

It is a different thing from the plugin's hooks: the hooks shell out to
the local `sonar` CLI and gate the session, while the MCP server talks to
the **server** — the issues it already knows about, the quality gates, the
rules, the measures.

## Prerequisites

The server does not start without these:

| Variable          | Value                                       |
| ----------------- | ------------------------------------------- |
| `SONARQUBE_TOKEN` | A user token for the instance               |
| `SONARQUBE_URL`   | Your Server URL, or `https://sonarcloud.io` |

A container runtime must be installed and running — but not necessarily
Docker Desktop. The server is launched through the `docker` CLI, and
OrbStack, Colima, Rancher Desktop and Lima all provide one, so any of
them works unchanged. Podman's CLI is `podman`, so it needs Podman's
`docker` shim installed.

The token is read from the environment, never written into the plugin,
and is passed to the container as a bare `-e SONARQUBE_TOKEN` so it never
appears in the container's argument list.

If tools are missing or failing, check those two variables and the
container runtime first — that is almost always the cause. When the
runtime is the problem, say which of the two it is (no runtime installed
and running, or a Podman install with no `docker` shim) rather than
reporting a generic connection failure.

## What this configuration enables

`SONARQUBE_TOOLSETS` is set explicitly, so the surface is exactly this
and nothing else:

- **Analysis** — run analyzers over a snippet or file content.
- **IDE** — bridge to a running SonarQube for IDE instance: analyze
  working-directory files, toggle background analysis.
- **Projects** — find projects, discover branches and pull requests.
- **Issues** — search issues, and change their status (resolve,
  won't-fix).
- **Security hotspots** — search and review security-sensitive code that
  needs human judgment.
- **Quality gates** — list gates, and check a project's pass/fail.
- **Rules** — details and rationale for a rule.
- **Duplications** — find duplicated blocks.
- **Measures** — lines of code, complexity, coverage %, violation counts.
- **Dependency risks** — SCA findings. _Requires SonarQube Server 2025.4
  Enterprise+ with Advanced Security, or the Cloud equivalent._
- **Coverage** — line-by-line coverage detail, under-covered file
  discovery.
- **Agentic readiness** — Vortex tooling for writing code that passes
  analysis.
- **Sources** — raw source and SCM blame info. _Requires the "See Source
  Code" permission._
- **Languages** — the languages the instance supports.
- **Portfolios** — browse portfolios. _Enterprise tier._

## What is deliberately left off

Don't look for these; they are not enabled:

- **Vortex context** — architecture search, call-flow tracing, coding
  guidelines. Cloud-only, and needs a Vortex entitlement.
- **Vortex** — the unified analysis toolset for Vortex-entitled
  organizations; supersedes Analysis when active.
- **System** — ping, status, health, logs. Some of it needs Administer
  permission.
- **Webhooks** — create and list webhooks. Requires Administer
  permission.

### Advanced options — all off

- Debug logging.
- Read-only mode (it would restrict the server to read-only tools,
  disabling issue-status changes and webhook creation).
- Custom SSL CA certificate (for internally-signed TLS).

### Other settings — unset

- **No default project key.** `SONARQUBE_PROJECT_KEY` is not pre-filled,
  so `projectKey` must be supplied on each request that needs one. Get it
  from `.sonarlint/connectedMode.json` (see the
  `sonarqube-connected-mode` skill) rather than guessing.
- **No workspace mount / host path.** Only `run_advanced_code_analysis`
  and the Vortex context tools need it, and both are off — so this is
  consistent, not an oversight.

## Working with it

**Finding the project.** Nearly every call needs a `projectKey`. Read it
from the repository's `.sonarlint/connectedMode.json` first; ask the user
only if there is no binding and the project-search tools don't give an
unambiguous match.

**Issues vs. the hooks.** The MCP server reports what the **server**
knows, which is the last analysis it ingested — not your uncommitted
working tree. For "is the code I just wrote clean?", the hooks and the
`sonar` CLI are the authority. For "what does this project owe already?",
use the MCP server.

**Reading a rule before acting.** When a finding's message isn't
self-explanatory, fetch the rule. The rationale usually distinguishes a
real defect from a stylistic preference, which is what decides whether to
change the code.

**Changing issue status is a real, visible action.** Resolving an issue
or marking it won't-fix writes to the shared instance and other people
see it. Ask the user before doing it, and never do it in bulk to make a
quality gate pass.

**Security hotspots are not issues.** A hotspot is security-sensitive
code that needs a human to decide whether it's actually a vulnerability.
Surface it and explain the risk; don't mark it safe on the user's behalf.

## Related skills

- `sonarqube-connected-mode` — where `projectKey` comes from.
- `sonarqube-issue-triage` — how to prioritise and act on findings.
- `analyze` (`/sonarqube:analyze`) — run the local CLI instead.
