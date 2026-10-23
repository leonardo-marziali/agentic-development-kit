# Connected mode (phase 2 design)

Status: **design only, not implemented.** Today the local engine runs in
standalone mode, using each analyzer's default rules. This document
describes how to bind it to SonarQube Server or SonarQube Cloud, so local
findings match what the server would report.

## What connected mode buys

- **The server's quality profile.** Rules activated, deactivated or
  re-parameterised on the server apply locally. This is the main gap
  today: standalone can report a rule your organization turned off.
- **Server-matched issue status.** Issues already marked accepted or
  false-positive on the server are suppressed locally.
- **Hotspots and taint vulnerabilities** for the bound branch, which only
  a server can compute.
- **The server's analyzer versions**, optionally. SLOOP can download the
  plugins the server runs instead of using the embedded ones.

## Where the binding comes from

`.sonarlint/connectedMode.json`, which the hooks already resolve per file
(`scripts/hooks/connected-mode.js`): `projectKey` plus `sonarQubeUri`
(Server) or `sonarCloudOrganization` (Cloud). One configuration scope per
binding root, which matters in a monorepo with several bindings.

## Credentials

Never in the repository, never in logs, never on a command line.

- **Source, in order:** `SONARQUBE_CLI_TOKEN`, the same variable the
  `sonar` CLI uses, so one token serves both; then the OS keychain entry
  `sonar auth login` writes, if its format turns out to be stable and
  readable. Otherwise a plugin `userConfig` option with
  `sensitive: true`, which Claude Code keeps in secure storage and
  exports to hooks as `CLAUDE_PLUGIN_OPTION_<KEY>`.
- **Delivery:** SLOOP asks the client through the `getCredentials`
  callback. The daemon answers from memory. The token never goes into
  `InitializeParams`, the socket protocol, the daemon log, `--verbose`
  output, or `install.json`.
- **Log hygiene:** the daemon's log sink redacts anything that matches the
  token before writing. SLOOP's own logs at INFO don't print credentials,
  but redaction makes that a guarantee rather than an observation.
- **`invalidToken`** notification: drop the binding back to standalone
  and report it once, rather than retrying with a bad token.

## RPC methods needed

From `rpc-protocol` at `12.1.1.87771`.

Initialization:

- `InitializeParams.sonarQubeConnections`:
  `[{ connectionId, serverUrl, disableNotifications }]`.
- `InitializeParams.sonarCloudConnections`:
  `[{ connectionId, organization, region, disableNotifications }]`.
- `InitializeParams.backendCapabilities`: add `PROJECT_SYNCHRONIZATION`,
  plus `SECURITY_HOTSPOTS` and `FULL_SYNCHRONIZATION` if hotspots and
  taint are wanted. These are what open network connections; standalone
  sends none.
- `InitializeParams.connectedModeEmbeddedPluginPathsByKey`: analyzers to
  prefer over server downloads, keyed by plugin key.
- `InitializeParams.extraEnabledLanguagesInConnectedMode`.

Backend (client → SLOOP):

- `connection/didUpdateConnections` — add or remove connections at
  runtime.
- `connection/didChangeCredentials` — after a token rotation.
- `connection/validateConnection` — for `doctor` and `setup`.
- `configuration/didAddConfigurationScopes` with
  `binding: { connectionId, sonarProjectKey, bindingSuggestionDisabled: true }`.
- `configuration/didUpdateBinding` — when `connectedMode.json` changes.
- `branch/didVcsRepositoryChange` — after a branch switch, so the matched
  server branch follows.
- `rule/getEffectiveRuleDetails` — rule details as configured on the
  server, replacing `getStandaloneRuleDetails`.
- `analysis/analyzeFilesAndTrack` with `shouldFetchServerIssues: true`.
- `issue/changeStatus`, `issue/addComment` — only behind an explicit user
  request, like `sonar api post` today.

Client callbacks (SLOOP → client), beyond the standalone set:

- `getCredentials` → `{ credentials: { token } }`.
- `matchSonarProjectBranch` → the current git branch, if the server knows
  it.
- `didSynchronizeConfigurationScopes` — storage is ready; analysis
  reflects the profile from here on.
- `invalidToken`, `didChangeTaintVulnerabilities`, `raiseHotspots`,
  `didChangeMatchedSonarProjectBranch`.
- `selectProxies`, `getProxyPasswordAuthentication`,
  `checkServerTrusted` — proxies and corporate TLS. Use
  `HttpConfigurationDto.sslConfiguration` for a custom trust store.

## Analyzer version sync

In connected mode SLOOP downloads the server's analyzer plugins into
`storageRoot` during synchronization, so local analysis uses the same
versions as the server. That is a network fetch the plugin doesn't pin.
Two options:

1. **Follow the server** (SonarQube for IDE's behaviour). Findings match
   exactly; the pinned-checksum guarantee covers only the embedded
   fallback.
2. **Keep the pinned analyzers** by listing them in
   `connectedModeEmbeddedPluginPathsByKey`, so only the profile (rule
   activation) syncs. Versions may differ from the server's, but nothing
   unpinned runs.

The proposal: default to option 2, with option 1 as a `userConfig`
choice. That keeps the plugin's no-unpinned-code-at-runtime property
unless someone opts out of it.

## Plugin changes

- `cli/sloop.js`: connection-aware `initializeParams`, `getCredentials`,
  and one scope per binding instead of one per root.
- `cli/daemon.js`: read bindings for the root; re-read on change; a
  `binding` field in `status`.
- `doctor`: "bound to X on Y, profile synced at T", or why not.
- Hooks: unchanged. They already group by binding.
- Tests: a stub server, or mocked `getCredentials`/sync responses,
  asserting no token ever reaches stdout, stderr or the log.

## Open questions

- Can the `sonar` CLI's keychain entry be read portably (macOS Keychain,
  libsecret, Windows Credential Manager) without adding native
  dependencies, which plugins can't have? If not, environment variable
  or sensitive `userConfig` only.
- Does a first synchronization fit in a Stop hook's 180s budget on a
  large project? Probably not, which suggests syncing from the
  SessionStart warm-up and analyzing standalone until
  `didSynchronizeConfigurationScopes` arrives.
