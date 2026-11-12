---
name: setup
description: Use when the user asks to "set up the java plugin", "enable the Java standard in this project", "opt this project in", "install the Java engine", or "create the ArchUnit baseline". Installs the plugin's pinned JDT, Error Prone and ArchUnit tools, writes .claude/java-standards.json for a new or brownfield project, and optionally records the ArchUnit freeze baseline.
argument-hint: '[new | brownfield]'
disable-model-invocation: true
allowed-tools: Bash(node *) Bash(java -version) Bash(git ls-files *) Bash(git status *) Read Grep Glob Write
---

# Java Setup

Opt a project into the Java standard. Arguments given: `$ARGUMENTS`

Nothing here touches the project's `pom.xml` or `build.gradle`: the
plugin's tools run outside the build, and the opt-in lives in
`.claude/java-standards.json`.

## 1. Install the engine

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/install-engine.js"`. It downloads
the pinned jars (about 40 MB, checksums verified) into the plugin's data
directory and compiles the engine. It needs a JDK 21 or newer on
`JAVA_HOME` or `PATH`; if it reports an older or missing JDK, stop and tell
the user. Offline: `--from-dir <dir>` installs from a directory holding the
jars under their Maven file names; `JAVA_PLUGIN_ARTIFACT_BASE_URL` points it
at a Maven mirror.

## 2. Look at the project

- Build tool: `pom.xml` or `build.gradle(.kts)`, and the modules
  (`git ls-files` for build files).
- Base package: the common package of `src/main/java` (e.g. `com.acme.orders`).
- Formatter profile: a committed Eclipse formatter export, or
  `.settings/org.eclipse.jdt.core.prefs`.
- Whether the project is **new** or **brownfield** — use the argument if
  given, otherwise ask. For brownfield, ask which paths the standard should
  cover (e.g. only a new `v2` package) and which to leave alone (e.g. a
  frozen `v1` package).

## 3. Write `.claude/java-standards.json`

Show the file you will write and ask before writing it. Every section is
optional; omit what keeps its default.

```json
{
  "include": ["src/main/java/com/acme/orders/v2/", "src/test/java/**/v2/"],
  "exclude": ["**/v1/", "**/generated/"],
  "formatter": {
    "enabled": true,
    "profile": "config/eclipse-formatter.xml",
    "scope": "changed-lines"
  },
  "checks": { "enabled": true, "disabledRules": [] },
  "nullaway": { "enabled": true, "annotations": "auto" },
  "archunit": {
    "enabled": true,
    "basePackage": "com.acme.orders",
    "packages": ["com.acme.orders.v2.."],
    "disabledRules": [],
    "compile": "auto"
  },
  "javaVersion": null
}
```

- **New project**: no `include`/`exclude` (the whole repository), the
  plugin's default formatter profile unless the project has its own.
- **Brownfield**: `include` the new paths, `exclude` the legacy ones
  (gitignore syntax), `archunit.packages` the new packages.
- Set `javaVersion` only if the build doesn't declare one the plugin can
  read.

## 4. Optional: the ArchUnit baseline (brownfield)

Offer to record the current ArchUnit violations so only new ones block:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/check.js" --create-archunit-store`, run
from the repository. It compiles the modules if their classes are stale
and writes `.claude/archunit-store/`; commit it with the config. The Stop
hook never creates or refreezes this store.

## 5. Report

Summarize what was installed and written, and remind the user that
projects with old builds (Java 8 or 11) can list their JDKs in the
plugin's `jdk_homes` option (`/config`) so the project's own Maven or
Gradle runs on the right JDK.
