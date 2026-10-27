# [2.3.0](https://github.com/leonardo-marziali/agentic-development-kit/compare/v2.2.0...v2.3.0) (2026-10-27)


### Features

* **ad-lfl-kit:** track Bash/MCP writes and make Stop hooks actually block ([#30](https://github.com/leonardo-marziali/agentic-development-kit/issues/30)) ([e959dd2](https://github.com/leonardo-marziali/agentic-development-kit/commit/e959dd2fc816113b8e6b4a919b1834d274be46ca))

# [2.2.0](https://github.com/leonardo-marziali/agentic-development-kit/compare/v2.1.0...v2.2.0) (2026-10-25)


### Features

* **sonarqube:** cap the analysis daemon's memory ([#28](https://github.com/leonardo-marziali/agentic-development-kit/issues/28)) ([ac8774c](https://github.com/leonardo-marziali/agentic-development-kit/commit/ac8774c3cbfaf0b751b9fda8230f1bdb9b9afe10))

# [2.1.0](https://github.com/leonardo-marziali/agentic-development-kit/compare/v2.0.0...v2.1.0) (2026-10-23)


### Features

* **devcontainer:** install the SonarLint VS Code extension ([a7e1248](https://github.com/leonardo-marziali/agentic-development-kit/commit/a7e1248d467753d5d999095f54f22e5f5a058204))

# [2.0.0](https://github.com/leonardo-marziali/agentic-development-kit/compare/v1.9.1...v2.0.0) (2026-10-23)


* feat(sonarqube)!: replace MCP with sonar api and local SonarLint analysis ([#26](https://github.com/leonardo-marziali/agentic-development-kit/issues/26)) ([a70c05e](https://github.com/leonardo-marziali/agentic-development-kit/commit/a70c05ec8bee1842155160423567277dd1d7b02b))


### BREAKING CHANGES

* the plugin no longer registers the `sonarqube` MCP
server. Use `sonar api` (see the sonarqube-web-api skill) instead.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TZq3ZGPfok41w4q4H9SC3R

* feat(sonarqube): add pinned SLOOP provisioning

Pin the SonarLint backend (sonarlint-backend-cli 12.1.1.87771, with a
bundled Temurin 21 JRE per platform) and the nine analyzers SonarLint for
VS Code ships, each with a SHA-256 computed from a download whose .sha1
matched Maven Central.

- install-sloop.js installs into the plugin data dir; downloads honour
  SONARLINT_ARTIFACT_BASE_URL for an internal mirror, and --from-dir
  installs offline
- every artifact is verified before use and the install fails closed:
  no manifest is written unless everything checked out
- check-updates.js diffs the pins against Maven metadata without ever
  rewriting them
- musl Linux and unsupported platforms fall back to the no-arch archive
  with a system Java 17+

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TZq3ZGPfok41w4q4H9SC3R

* feat(sonarqube): add sonarlint CLI and per-project SLOOP daemon

A thin `sonarlint` CLI (files, stdin, rules, daemon, doctor) talks over
a private Unix socket / named pipe to a per-project daemon that keeps
SLOOP warm: ~20s cold, ~1s per analysis afterwards.

- JSON-RPC to SLOOP via vscode-jsonrpc (zero dependencies, pinned in
  the plugin's npm lockfile); standalone mode, no network, no telemetry
- every file the daemon reads is held to the project root, symlinks
  included; stdin analysis registers a virtual file and writes nothing
- compact output for an LLM reader: issues sorted worst-first, clean
  files as a count, exit 0/1/2 against --min-severity
- one analysis at a time with timeouts; SLOOP is restarted once, and a
  second crash leaves a marker so later calls fail fast with exit 2
- integration test against a real SLOOP (skipped when not installed)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TZq3ZGPfok41w4q4H9SC3R

* feat(sonarqube)!: run SonarQube for IDE analysis in the hooks

The hooks now use the local SLOOP engine through the plugin's sonarlint
CLI instead of `sonar analyze`, which was Cloud-only and refused to run
even its local secrets stage without credentials. Analysis is offline
and identical for SonarQube Server, Cloud, or no server at all.

- SessionStart warms the project's daemon in the background
- PostToolUse reports MAJOR/MEDIUM+ issues and secrets on the edited
  file's changed lines as additionalContext; it never blocks and never
  pays a cold JVM start
- Stop/SubagentStop block on secrets anywhere in a touched file and on
  issues at/above min_blocking_severity on lines changed vs HEAD;
  pre-existing findings are reported once instead
- tool failures are reported and never block, and keep the session
  state so the next stop retries
- tests drive the hooks through a stand-in CLI via SONARLINT_CLI
* the `analysis_depth` and `block_on` options are
replaced by `min_blocking_severity`, `per_edit_feedback` and
`daemon_idle_minutes`, and the hooks no longer call the `sonar` CLI.
Run /sonarqube:setup once to install the local engine.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TZq3ZGPfok41w4q4H9SC3R

* feat(sonarqube): add local analysis skills

- sonarlint-analysis: when and how Claude runs the local CLI, how to
  read its output and exit codes, the severity policy, and a two-round
  cap on fix-and-recheck
- fix (/sonarqube:fix): work through findings or one rule key, reading
  the rule first, fixing minimally, never adding NOSONAR unasked
- setup (/sonarqube:setup): doctor, pinned install, mirror and offline
  installs, troubleshooting, update checks
- analyze: now runs the local engine instead of `sonar analyze`
- connected-mode and triage skills describe the local engine

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TZq3ZGPfok41w4q4H9SC3R

* docs(sonarqube): document local analysis, SLOOP protocol and connected mode

- rewrite the plugin README: requirements, setup, the hooks and their
  blocking policy, the sonarlint CLI, options, enterprise notes (no MCP,
  offline, mirrors), version pinning, known limitations, testing
- docs/SLOOP_PROTOCOL_NOTES.md: artifacts, transport, handshake,
  callbacks and result shapes, each marked as read from source or
  confirmed against a live backend
- docs/CONNECTED_MODE.md: phase-2 design for binding to SonarQube
  Server/Cloud, with the exact RPC methods and token handling
- point the root README, .env.example and devcontainer at the SonarQube
  CLI's SONARQUBE_CLI_* variables instead of the MCP server's

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TZq3ZGPfok41w4q4H9SC3R

* ci(sonarqube): install the pinned SonarLint engine for the plugin suite

The sonarqube plugin's integration test drives a real SLOOP and skips
without one. Install it (cached on sloop.lock.json) before running the
suite, so CI exercises real analysis rather than only the stand-in.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TZq3ZGPfok41w4q4H9SC3R

* fix(sonarqube): exit 2 when the daemon fails before it starts

main() only caught failures of run(); a throw from parsing argv became an
unhandled rejection. Catch it at the entry point and exit 2, like every
other daemon failure.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TZq3ZGPfok41w4q4H9SC3R

## [1.9.1](https://github.com/leonardo-marziali/agentic-development-kit/compare/v1.9.0...v1.9.1) (2026-10-22)


### Bug Fixes

* **devcontainer:** install plugin dependencies from their npm lockfiles ([#25](https://github.com/leonardo-marziali/agentic-development-kit/issues/25)) ([b328f15](https://github.com/leonardo-marziali/agentic-development-kit/commit/b328f15f83970de603a2c0956bfeaf7ded6f1530))

# [1.9.0](https://github.com/leonardo-marziali/agentic-development-kit/compare/v1.8.1...v1.9.0) (2026-10-22)


### Features

* **python:** add python plugin with ruff and pyright checks ([#23](https://github.com/leonardo-marziali/agentic-development-kit/issues/23)) ([7cae994](https://github.com/leonardo-marziali/agentic-development-kit/commit/7cae994bec8eb6cf7e5a9f9bb2ad53484844b95e))

## [1.8.1](https://github.com/leonardo-marziali/agentic-development-kit/compare/v1.8.0...v1.8.1) (2026-10-22)


### Bug Fixes

* **devcontainer:** log in via terminal task instead of remote-control session ([#22](https://github.com/leonardo-marziali/agentic-development-kit/issues/22)) ([dd86629](https://github.com/leonardo-marziali/agentic-development-kit/commit/dd8662983dad86cce6e92a450b248ec3018d3482))

# [1.8.0](https://github.com/leonardo-marziali/agentic-development-kit/compare/v1.7.0...v1.8.0) (2026-10-21)


### Features

* **devcontainer:** develop this repo in its own claude-devcontainer image ([#21](https://github.com/leonardo-marziali/agentic-development-kit/issues/21)) ([b99cf11](https://github.com/leonardo-marziali/agentic-development-kit/commit/b99cf11264f995861f2affe15c69aa24480c0399))

# [1.7.0](https://github.com/leonardo-marziali/agentic-development-kit/compare/v1.6.0...v1.7.0) (2026-10-21)


### Features

* **devcontainer:** add Claude Code dev container image published to GHCR ([#20](https://github.com/leonardo-marziali/agentic-development-kit/issues/20)) ([92dad32](https://github.com/leonardo-marziali/agentic-development-kit/commit/92dad32d3a8becac8a1bbfe3be4b5decff67a457))

# [1.6.0](https://github.com/leonardo-marziali/agentic-development-kit/compare/v1.5.1...v1.6.0) (2026-10-21)


### Features

* **ad-lfl-kit:** scope checks to changes against HEAD ([#19](https://github.com/leonardo-marziali/agentic-development-kit/issues/19)) ([a98a633](https://github.com/leonardo-marziali/agentic-development-kit/commit/a98a633f994a52ac2cae3852ab925b36c7a108b0))

## [1.5.1](https://github.com/leonardo-marziali/agentic-development-kit/compare/v1.5.0...v1.5.1) (2026-09-14)


### Bug Fixes

* resolve open SonarCloud findings ([#18](https://github.com/leonardo-marziali/agentic-development-kit/issues/18)) ([fe68633](https://github.com/leonardo-marziali/agentic-development-kit/commit/fe68633587265b8b33a597c93040ee2f19290519))

# [1.5.0](https://github.com/leonardo-marziali/agentic-development-kit/compare/v1.4.1...v1.5.0) (2026-09-14)


### Features

* **sonarqube:** enable plugin and load token from .env ([17088dc](https://github.com/leonardo-marziali/agentic-development-kit/commit/17088dc1117a3375f0e4ab6d4f6e0c04bbdfce8c))

## [1.4.1](https://github.com/leonardo-marziali/agentic-development-kit/compare/v1.4.0...v1.4.1) (2026-09-14)


### Bug Fixes

* **sonarqube:** remove unsupported enum keys from plugin manifest ([3aacf6b](https://github.com/leonardo-marziali/agentic-development-kit/commit/3aacf6b2f8451ca747c111bc572edff2f0776d3f))

# [1.4.0](https://github.com/leonardo-marziali/agentic-development-kit/compare/v1.3.0...v1.4.0) (2026-09-14)


### Features

* **sonarqube:** add plugin with analysis hooks and MCP server ([#15](https://github.com/leonardo-marziali/agentic-development-kit/issues/15)) ([a568025](https://github.com/leonardo-marziali/agentic-development-kit/commit/a56802532471d0af39191dd82ed6c8edb94aad8f))

# [1.3.0](https://github.com/leonardo-marziali/agentic-development-kit/compare/v1.2.0...v1.3.0) (2026-09-11)


### Features

* **ad-lfl-kit:** add shared lint-fix-loop package ([7df0601](https://github.com/leonardo-marziali/agentic-development-kit/commit/7df06011321b3f9970923e79338359b2cdb031b5))

# [1.2.0](https://github.com/leonardo-marziali/agentic-development-kit/compare/v1.1.0...v1.2.0) (2026-09-07)


### Bug Fixes

* **terraform:** use RepositoryRole bypass instead of Integration ([e30df29](https://github.com/leonardo-marziali/agentic-development-kit/commit/e30df29d777fe0dd3e0b8c0bba396b67bf367de8))


### Features

* **release:** generate CHANGELOG.md via semantic-release ([2f8d3cd](https://github.com/leonardo-marziali/agentic-development-kit/commit/2f8d3cd006748d2a488f01a03cba344a18901ef7))
