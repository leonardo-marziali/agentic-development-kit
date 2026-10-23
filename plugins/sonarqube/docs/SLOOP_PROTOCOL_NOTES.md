# SLOOP protocol notes

How this plugin talks to SLOOP — `sonarlint-backend-cli`, the analysis
backend of SonarQube for IDE — and where each fact comes from. Everything
below was read from [SonarSource/sonarlint-core][core] at tag
`12.1.1.87771` (the pinned version), then checked against a live backend.
Each item says whether it was confirmed live or is from the source only.

[core]: https://github.com/SonarSource/sonarlint-core/tree/12.1.1.87771

## Artifacts

Published to Maven Central as
`org.sonarsource.sonarlint.core:sonarlint-backend-cli` (not only to
SonarSource's repox), with these classifiers:

- `linux_x64`, `linux_aarch64`: tar.gz (~95 MB), bundled Temurin
  `jdk-21.0.10+7`.
- `macosx_x64`, `macosx_aarch64`: tar.gz (~85-91 MB), same JRE.
- `windows_x64`: zip (~92 MB), same JRE.
- `no-arch`: zip (~43 MB), no JRE; needs Java 17+.

- Layout: `lib/*.jar` (70 jars, including
  `sonarlint-backend-cli-<version>.jar`) and, in platform builds,
  `jre/bin/java`. See `backend/cli/src/main/assembly/*.xml`. _Live._
- Main class: `org.sonarsource.sonarlint.core.backend.cli.SonarLintServerCli`;
  launch as `java -cp "lib/*" <main>`. _Live._
- Maven Central has `.sha1`, `.md5` and `.asc` per file, **no SHA-256**.
  `sloop.lock.json` pins SHA-256 values computed from downloads whose
  SHA-1 matched Maven Central (all 15 artifacts checked).
- The backend redirects `System.out` to stderr, so stdout carries only
  JSON-RPC. It exits when stdin closes (`EndOfStreamAwareInputStream`).

**Analyzers are not bundled.** The client passes their paths in
`InitializeParams.embeddedPluginPaths`. The pinned set is the one
SonarLint for VS Code ships (its `package.json` `jarDependencies`), all on
Maven Central: `sonar-javascript-plugin`, `sonar-python-plugin`,
`sonar-java-plugin`, `sonar-text-plugin` (secrets), `sonar-iac-plugin`,
`sonar-go-plugin`, `sonar-php-plugin`, `sonar-html-plugin`,
`sonar-xml-plugin`. `sonarlint-omnisharp-plugin` (C#) needs credentialed
repox access and is left out.

The plain `sonar-javascript-plugin` jar embeds its Node bundle
(`sonarjs-1.0.0.tgz`) but no Node binary. It needs Node >= 22.12
(`node-info.properties`). Per-platform jars with Node embedded exist but
aren't needed.

## Transport

lsp4j JSON-RPC 2.0 with `Content-Length` framing over the child's stdio
(`BackendJsonRpcLauncher`). Calls go both ways: SLOOP sends requests to
the client and waits for answers. `vscode-jsonrpc`'s
`StreamMessageReader`/`Writer` speak the same framing. _Live._

Method names come from `@JsonSegment` on each service interface plus the
method name. `SonarLintRpcClient` has no segment, so client callbacks are
bare names (`listFiles`, not `client/listFiles`).

## Handshake (as implemented in `cli/sloop.js`)

1. `initialize(InitializeParams)` — request, empty result. _Live._
2. `configuration/didAddConfigurationScopes` with one scope:
   `{ id, parentId: null, bindable: false, name, binding: null }`.
3. Wait for the client notification `didChangeAnalysisReadiness` with
   `areReadyForAnalysis: true` for that scope.
   It arrives ~0.3s after step 2 in standalone mode. _Live._
4. Per analysis:
   `file/didUpdateFileSystem` (`addedFiles`, `changedFiles`,
   `removedFiles`, as `ClientFileDto`s), then
   `analysis/analyzeFilesAndTrack` with `configurationScopeId`, a fresh
   `analysisId`, `filesToAnalyze: [uri]`, `extraProperties: {}` and
   `shouldFetchServerIssues: false`.
5. `shutdown`, then close stdin.

`InitializeParams` fields set by the plugin: `clientConstantInfo`,
`telemetryConstantAttributes`, `httpConfiguration` (ISO-8601 durations),
`backendCapabilities: []` (no telemetry, sync, server-sent events or
embedded server), `storageRoot`, `workDir`, `embeddedPluginPaths`,
`enabledLanguagesInStandaloneMode`, `sonarlintUserHome`,
`standaloneRuleConfigByKey: {}`, `isFocusOnNewCode: false`,
`languageSpecificRequirements.jsTsRequirements` (`clientNodeJsPath` set
to the daemon's own Node, `bundlePath: null`),
`automaticAnalysisEnabled: false`, `logLevel`.

## Client callbacks

SLOOP called these during a standalone session (_live_):
`listFiles`, `getBaseDir`, `getFileExclusions`,
`getInferredAnalysisProperties`, `startProgress`, and the notifications
`log`, `didChangePluginStatuses`, `didChangeAnalysisReadiness`,
`raiseIssues`, `reportProgress`, `didDetectSecret`.

| Callback                        | Response                        |
| ------------------------------- | ------------------------------- |
| `listFiles`                     | `{ files: ClientFileDto[] }`    |
| `getBaseDir`                    | `{ baseDir: <path> }`           |
| `getFileExclusions`             | `{ fileExclusionPatterns: [] }` |
| `getInferredAnalysisProperties` | `{ properties: {} }`            |
| anything else                   | `null` (logged)                 |

`ClientFileDto`: `uri`, `ideRelativePath`, `configScopeId`, `isTest`,
`charset`, `fsPath`, `content`, `detectedLanguage`, `isUserDefined`.

- `isUserDefined: true` is required, or SLOOP filters the file out. This
  matches the community notes in
  [nielspeter/sonarlint-mcp-server][community] (MIT), which were used as
  a reference only; no code was copied.
- `content` is sent inline, so SLOOP never reads the file itself, and
  virtual (stdin) files work the same way.
- `detectedLanguage: null` is fine: a `.env` file with no language was
  still scanned for secrets. _Live._

[community]: https://github.com/nielspeter/sonarlint-mcp-server

## Results

Both arrive for every analysis (_live_):

- The `analyzeFilesAndTrack` **response**:
  `{ failedAnalysisFiles: [uri], rawIssues: [...] }`. Each raw issue has
  `ruleKey`, `primaryMessage`, `fileUri`, `severity` and `type`
  (Standard), `impacts` as a `{ SOFTWARE_QUALITY: SEVERITY }` map (MQR),
  `textRange { startLine, startLineOffset, endLine, endLineOffset }`,
  `quickFixes`, and `flows`. It is scoped to exactly the requested files.
  **The plugin uses this.**
- The **`raiseIssues`** notification (`issuesByFileUri`,
  `isIntermediatePublication`, `analysisId`), with `RaisedIssueDto`s whose
  `severityMode` is an lsp4j `Either`, serialized as the bare left or
  right object: `{severity, type}` or `{cleanCodeAttribute, impacts:
[{softwareQuality, impactSeverity}]}`. Its map holds every issue known
  in the scope, not just the requested files. The final (non-intermediate)
  publication arrived **before** the response in every run observed. The
  plugin keeps it as a fallback, correlated by `analysisId` and filtered to
  the requested URIs.

`Language` enum spellings are the Java constant names: `JS`, `TS`,
`CSS`, `PYTHON`, `IPYTHON`, `JAVA`, `GO`, `PHP`, `HTML`, `XML`, `SECRETS`,
`TEXT`, `TERRAFORM`, `CLOUDFORMATION`, `KUBERNETES`, `DOCKER`,
`AZURERESOURCEMANAGER`, `GITHUBACTIONS`, `JSON`, and so on.

Rules: `rule/getStandaloneRuleDetails({ ruleKey })` returns
`{ ruleDefinition, description }`, where `description` is an `Either` of a
monolithic `{htmlContent}` or a split
`{introductionHtmlContent, tabs[...]}`.
`rule/listAllStandaloneRulesDefinitions()` returns `{ rulesByKey }` —
2,965 rules with the pinned analyzers. _Live._

## Timings (linux arm64, pinned versions)

| Step                                     | Time     |
| ---------------------------------------- | -------- |
| Spawn to `initialize` result             | ~3 s     |
| Readiness after scope added              | ~0.3 s   |
| First analysis with JS/TS (bridge start) | ~20-23 s |
| Warm analysis                            | ~1-2.5 s |

## Deviations from the original brief

- Lives in `plugins/sonarqube`, not a new `sonarlint-local/` plugin.
- CommonJS JavaScript, not TypeScript/ESM: the repository's plugins have
  no build step (see `AGENT.md`).
- `bundlePath` is `null`; the JS/TS analyzer unpacks its own bundle. The
  brief assumed the client might have to extract it, as VS Code does.
- The per-edit hook ships enabled (non-blocking, warm daemon only), rather
  than as an opt-in example.
- Files with issues above the threshold use exit 1, as briefed; but the
  hooks call the CLI with `--min-severity INFO` and apply their own policy
  to the JSON.

## Observed but not acted on

- `WARN No workDir in SonarLint` appears on each analysis even with
  `workDir` set and existing. It's harmless.
- `WARN Using H2 2.4.240 which is newer than … Flyway has been verified
with` appears at start-up. It's harmless.
- When a daemon is rooted at a very large non-git directory, the JS/TS
  bridge can exceed its 300s start-up timeout, because it scans under the
  base dir. The analysis then reports a Node.js error rather than issues.
