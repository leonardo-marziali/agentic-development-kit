---
name: setup
description: Use when the user asks to install, set up, update, or repair the SonarQube plugin's local analysis engine, when `sonarlint` exits 2 or `doctor` reports a failure, or when a hook says local analysis could not run or SLOOP is not installed.
allowed-tools: Bash(node *sonarlint.js *) Bash(node *install-sloop.js*) Bash(node *check-updates.js*)
---

# Set up local SonarQube analysis

The plugin analyzes code with SonarQube for IDE's engine (SLOOP), which is
installed once into the plugin's data directory. It is pinned: exact
versions and SHA-256 checksums live in `sloop.lock.json`, and nothing is
ever resolved to "latest".

## 1. Check

```bash
node "${CLAUDE_PLUGIN_ROOT}/cli/sonarlint.js" \
  --data-dir "${CLAUDE_PLUGIN_DATA}" doctor
```

Every line is `ok`, `FAIL`, or `--` (informational). Exit 0 means usable.

## 2. Install (or repair)

Tell the user what this does before running it. It downloads ~160-210 MB
from Maven Central: the backend with a bundled Java 21 runtime, plus nine
analyzer jars.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/install-sloop.js" \
  --data-dir "${CLAUDE_PLUGIN_DATA}"
```

Re-running is safe; files that already verify are kept. Then run
`doctor` again.

### Behind a corporate mirror or offline

- **Mirror** (Artifactory, Nexus): set `SONARLINT_ARTIFACT_BASE_URL` to the
  mirror's Maven 2 root, e.g.
  `SONARLINT_ARTIFACT_BASE_URL=https://nexus.example.com/repository/maven-central`.
- **Offline**: put the artifacts, under their Maven file names, in one
  directory and add `--from-dir <dir>`.
- **No bundled JRE for this platform** (Alpine/musl, or anything other than
  Linux/macOS x64/arm64 and Windows x64): the no-arch build is used, and it
  needs Java 17+ from `SONARLINT_JAVA` or `JAVA_HOME`.

Checksums are verified either way. A mismatch stops the install, and
nothing unverified is used.

## 3. Troubleshooting

- **`SLOOP is not installed`** — Run the install command above.
- **`doctor` says the install doesn't match `sloop.lock.json`** — The plugin was
  updated; re-run the install.
- **`checksum mismatch`** — Corrupt download or a mirror serving different
  bytes; re-run, or check the mirror.
- **`node` check fails / JS analyzer `UNSATISFIED_NODE_JS`** — JS/TS analysis
  needs Node >= 22.12.
- **`SLOOP crashed repeatedly`** — Read the daemon log path from the error, then
  `sonarlint daemon start`.
- **First analysis slow (~20-30s)** — Expected: JVM and analyzer start-up. Later
  runs take ~1s.
- **A daemon uses memory after work is done** — It exits after
  `daemon_idle_minutes`; or `sonarlint daemon stop`.

## 4. Updates (maintainers)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/check-updates.js"
```

This prints which pins are behind Maven Central. It never changes them:
bumping is a deliberate change to `sloop.lock.json`, with each SHA-256
re-pinned and the integration test re-run.
