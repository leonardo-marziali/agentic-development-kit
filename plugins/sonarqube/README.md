# SonarQube

[![sonarqube plugin coverage](https://codecov.io/gh/leonardo-marziali/agentic-development-kit/branch/main/graph/badge.svg?flag=sonarqube-plugin)](https://codecov.io/gh/leonardo-marziali/agentic-development-kit)

SonarQube for IDE, for an agent. While Claude writes code, this plugin
runs Sonar's own IDE analysis engine (SLOOP, the backend of SonarQube for
IntelliJ, VS Code and Eclipse) **locally and offline** on every file Claude
edits, hands Claude the findings as it goes, and keeps the session from
ending while touched files still have secrets or high-severity issues.
For what the server knows — open issues, quality gates, rules, measures —
it teaches Claude to call SonarQube Server or SonarQube Cloud through the
SonarQube CLI's `sonar api`, and `/sonarqube:analyze` and
`/sonarqube:fix` merge the server's open issues for a bound project
with the local findings.

No MCP server, no container runtime.

## Requirements

- **Node.js 22.12 or later** — the hooks run on it, and the JS/TS analyzer
  needs it.
- **The local engine**, installed once with `/sonarqube:setup` (see
  [Installation](#installation)). Until it is, the hooks do nothing
  except say so when a session ends.
- **The [SonarQube CLI][cli] (`sonar`)** — only for reading the server
  through `sonar api` (including `sonarlint server`). Local analysis
  doesn't use it. The plugin doesn't install the CLI.

[cli]: https://docs.sonarsource.com/sonarqube-cloud/advanced-setup/sonarqube-cli/

The CLI authenticates on its own, with `sonar auth login` (stored in the
system keychain) or `SONARQUBE_CLI_TOKEN` / `SONARQUBE_CLI_SERVER` /
`SONARQUBE_CLI_ORG`. The plugin never reads, stores or logs a token.

## Installation

Add this repository as a plugin marketplace in Claude Code and install
the `sonarqube` plugin from it:

```text
/plugin install sonarqube --marketplace leonardo-marziali/agentic-development-kit
```

Then install the local engine once:

```text
/sonarqube:setup
```

That downloads the pinned backend (with a bundled Java 21 runtime) and
nine analyzer jars — about 160-210 MB, depending on the platform — into
the plugin's data directory (`~/.claude/plugins/data/…`), verifies every
SHA-256, and runs `doctor`. Uninstalling the plugin removes it.

## What This Plugin Provides

### Hooks

- **`SessionStart`** — starts this project's analysis daemon in the
  background and warms it up, so the ~20s JVM and analyzer start-up isn't
  paid inside an edit.
- **`PostToolUse`** (`Edit`/`Write`/`MultiEdit`) — if the daemon is warm,
  analyzes the file and gives Claude the MAJOR/MEDIUM+ issues and secrets
  on the lines just changed. Never blocks.
- **`PreToolUse` / `PostToolUse` / `PostToolUseFailure`** — records the
  files each call touched: the one `Edit`/`Write` names, or, for `Bash`,
  `PowerShell` and MCP tools, whatever changed between the `PreToolUse`
  snapshot and the end of the call. A `run_in_background` command keeps
  being tracked on later calls and at `Stop`, for up to 2 hours.
- **`Stop` / `SubagentStop`** — analyzes every file the session touched (a
  subagent's `SubagentStop`: only the files that subagent touched),
  and **blocks** the session from ending on secrets and on issues at/above
  `min_blocking_severity` on changed lines, up to 3 attempts.

How the Stop gate decides:

- **Secrets always block**, in any touched file, under every setting. A
  credential on disk is a leak no matter who wrote the line.
- **Other issues block only on lines the working tree changed vs `HEAD`**
  (plus two lines of context). A one-line edit to an old file doesn't make
  its existing debt the session's problem. Pre-existing findings at the
  blocking level are reported once on stderr and let through.
- **Scope follows git**, the way SonarQube for IDE does: a file the
  repository ignores is not analyzed. Outside git, a short list of
  well-known generated/vendored directory names stands in.
- **A broken tool never blocks.** If the engine isn't installed, crashed,
  or timed out, the hook says the files were _not checked_ and lets the
  session end, keeping its state so the next stop tries again.
- **Nothing is ever written to your files.** At the attempt cap the
  remaining findings are reported, not suppressed. Auto-inserted
  `NOSONAR` comments would bury exactly what this plugin exists to
  surface.

In a monorepo, findings are grouped by the nearest
`.sonarlint/connectedMode.json`, so the report names the SonarQube project
each one belongs to.

### The `sonarlint` CLI

The hooks and skills share one CLI, `cli/sonarlint.js`:

```text
sonarlint files <paths...>        analyze files or directories
sonarlint server <paths...>       the server's open issues for them
sonarlint stdin --path <p>        analyze content not yet on disk
sonarlint rules --key <rule>      a rule's description
sonarlint rules --search <text>   find rule keys
sonarlint daemon start|stop|status
sonarlint doctor                  check Java, install, analyzers, daemon
```

Output is built for an LLM reader: one line per issue, worst first;
clean files are a count, never a list. `--format json` gives
`{issues: [{file, line, endLine, rule, severity, type, message,
hasQuickFix}], summary, skipped, failed}`. Exit codes: `0` clean or
below `--min-severity` (default HIGH), `1` issues at/above it, `2` the
tool couldn't run.

`sonarlint server` doesn't use the engine. For each file it finds the
nearest `.sonarlint/connectedMode.json`, takes that directory as the
scanner's base directory, and reads the open issues through
`sonar api get /api/issues/search`, scoped by `--branch` or
`--pull-request` if given. It prints them in the same shape as `files`,
plus each issue's server `key` and `status`. It also prints a `projects`
list with the revision of the server's last analysis, whether that is
`HEAD`, and which of the files changed since. It exits `2` when the
`sonar` CLI is missing or fails, or when no file is bound, so "the
server wasn't asked" never reads as "the server says clean". The hooks
never call it: they stay offline.

Behind it, one **daemon per project** (keyed by a hash of the git root)
keeps SLOOP warm: the first analysis takes ~20-30s, later ones about a
second. The daemon listens on a Unix socket (a named pipe on Windows) in a
private, per-user `0700` directory, runs one analysis at a time, restarts
SLOOP once if it crashes, and exits after `daemon_idle_minutes`.

### Skills

User-invocable:

- **`/sonarqube:analyze [paths]`** — analyze any files, including code the
  session never touched, and add the server's open issues for them
  when the project is bound.
- **`/sonarqube:fix [rule | paths]`** — work through findings, local or
  server-reported, or one rule.
- **`/sonarqube:setup`** — install, repair, mirror/offline configuration.

Knowledge (loaded when relevant):

- **sonarlint-analysis** — when and how Claude runs the local CLI, reading
  its output, the severity policy, and a two-round fix-and-recheck cap.
- **sonarqube-web-api** — reading SonarQube Server or Cloud through
  `sonar api`: recipes, Server vs Cloud differences, and when a write
  needs the user's say-so.
- **sonarqube-connected-mode** — `.sonarlint/connectedMode.json`, nearest
  binding, monorepos.
- **sonarqube-issue-triage** — what to fix first, secrets, false
  positives, quality gates, suppressions.

Skill names follow the repository's convention: knowledge skills take
the most specific subject they document (`sonarlint-` for the local
engine, `sonarqube-` for the server), and user-invocable skills get short
verb names.

## Options

Prompted when you enable the plugin; changeable later in `/config`.

**`min_blocking_severity`** — `high` (default), `blocker`, `medium`, or
`secrets-only`. Which local findings on changed lines keep a session
from ending: `high` means BLOCKER and CRITICAL/HIGH. Secrets block under
every setting.

**`per_edit_feedback`** — `true` (default). Whether the `PostToolUse`
hook shows Claude the issues in each edited file. The trade-off: a second
or two per edit for issues seen while the change is fresh, against
seeing them only at the Stop gate.

**`daemon_idle_minutes`** — `30` (default). The daemon is a JVM using
roughly 0.5-1 GB; it exits after this long without a request.

**`daemon_max_heap_mb`** — `768` (default). The daemon JVM's heap ceiling
(`-Xmx`). Without one, Java may grow to a quarter of the machine's — or
the dev container's — RAM. Raise it if the daemon log reports
`OutOfMemoryError`; a running daemon keeps its old limit until it
restarts (`sonarlint daemon stop`). `SONARLINT_MAX_HEAP_MB` overrides it.

**`bridge_max_heap_mb`** — `1024` (default). JavaScript and TypeScript
are analyzed in a separate Node process (the SonarJS bridge) that
`-Xmx` doesn't cover; this becomes its `--max-old-space-size`. If the
bridge runs out of memory, the analysis fails (exit `2`) with a message
naming this option, instead of quietly dropping every JS/TS finding, and
the daemon restarts SLOOP so the next analysis gets a fresh bridge.
`SONARLINT_BRIDGE_MAX_HEAP_MB` overrides it.

## Enterprise notes

- **No MCP, no containers.** Server data goes through the `sonar` CLI
  your organization already authenticates; local analysis is a local
  process.
- **Offline at analysis time.** SLOOP runs in standalone mode with no
  connections and no telemetry capability; the daemon makes no network
  calls. The only download is the explicit setup step.
- **Mirrors.** Set `SONARLINT_ARTIFACT_BASE_URL` to an Artifactory or
  Nexus Maven 2 root and setup downloads from there.
- **Air-gapped.** `node scripts/install-sloop.js --from-dir <dir>`
  installs from a directory holding the artifacts under their Maven file
  names.
- **Unsupported platforms** (musl/Alpine, anything without a bundled JRE)
  use the no-arch build with Java 17+ from `SONARLINT_JAVA` or
  `JAVA_HOME`.
- **Data locations.** Engine and analyzers: `${CLAUDE_PLUGIN_DATA}` (or
  `SONARLINT_HOME`). Daemon socket, pid and log: a private per-user
  directory under the OS temp dir.

## Version pinning

`sloop.lock.json` pins the backend (`sonarlint-backend-cli` 12.1.1.87771)
and each analyzer to an exact version — the set SonarLint for VS Code
ships — with a SHA-256 per artifact. Maven Central publishes only SHA-1
and MD5, so each SHA-256 was computed from a download whose `.sha1` was
first checked against Maven Central. Install fails closed on any
mismatch; nothing is resolved to "latest" at runtime.

To bump: `node scripts/check-updates.js` prints which pins are behind.
Update `sloop.lock.json`, re-pin the SHA-256 from a verified download, and
run the integration test. The script never edits the lock itself.

## Known limitations

- **Standalone rules only.** Local analysis uses each analyzer's default
  rule set, not your server's quality profile, so it can report a rule
  your organization disabled (or miss one it added). Connected mode is
  designed in [docs/CONNECTED_MODE.md](docs/CONNECTED_MODE.md) but not
  implemented.
- **Server-only rules.** The pinned analyzers lag SonarQube Cloud, so
  some rules exist only on the server. GitHub Actions workflows are the
  clearest case: the IaC analyzer accepts `.github/workflows/*.yml` but
  ships none of the `githubactions:*` rules, so local analysis reports
  them clean whatever they contain. `/sonarqube:analyze` covers this with
  `sonarlint server` when the project is bound. The Stop gate doesn't
  (it stays offline), and server results describe the last analyzed
  revision, not the working tree.
- **No security hotspots, taint analysis or C#/C/C++.** Hotspots and
  taint vulnerabilities come from a server; C# needs an analyzer not on
  Maven Central; C/C++ needs a compilation database.
- **Cold start.** The first analysis in a project takes ~20-30s; the
  per-edit hook skips files until the daemon is warm, and the Stop hook
  allows 150s.
- **Very large non-git directories are slow.** The JS/TS analyzer scans
  under the project root; rooting a daemon at a large non-git directory
  (your home, say) can exceed the analysis timeout. Inside a git
  repository the root is the repository.
- **Memory.** One JVM per project you work in, until it idles out.

See [docs/SLOOP_PROTOCOL_NOTES.md](docs/SLOOP_PROTOCOL_NOTES.md) for how
the plugin talks to SLOOP, and what was verified against a live backend.

## Testing

```bash
cd plugins/sonarqube
npm ci
pnpm test
```

The suites use Node's built-in test runner:

- **`cli/__tests__/`** — argument parsing, output formatting, severity
  normalisation, path containment, data/runtime paths, and provisioning
  (checksums, offline and mirror installs, fail-closed behaviour).
- **`cli/__tests__/server.test.js`** — `sonarlint server` against a
  fake `sonar api` (and, end to end, a stand-in `sonar` binary via
  `SONARLINT_SONAR_CLI`): binding lookup, component keys and Cloud
  organization, branch/PR scoping, freshness against `HEAD`, and exit 2
  for unbound files and failed calls.
- **`cli/__tests__/integration.test.js`** — starts a real daemon over a
  fixture project and asserts the rule keys SLOOP reports (an unused JS
  variable, a bare Python `except`, a GitHub token). Skipped, with a
  message, unless the engine is installed
  (`node scripts/install-sloop.js`, or point `SONARLINT_HOME` at an
  install).
- **`scripts/hooks/__tests__/`** — every hook, run as Claude Code runs
  it, against a stand-in CLI (`SONARLINT_CLI`) that logs its argv and
  answers from a spec: session scoping, the blocking policy and its
  options, change scoping vs `HEAD`, tool failures, the 3-attempt cap,
  connected-mode grouping, and per-edit feedback.

Coverage uses Node's built-in test-runner coverage:

```bash
pnpm test:coverage
```

This writes `coverage/lcov.info`, which the
[Plugin Tests](../../.github/workflows/plugin-tests.yml) workflow uploads
to Codecov on every pull request that touches this plugin. CI installs
the engine first (cached on `sloop.lock.json`), so the integration test
runs there.
