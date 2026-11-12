# Java

[![java plugin coverage](https://codecov.io/gh/leonardo-marziali/agentic-development-kit/branch/main/graph/badge.svg?flag=java-plugin)](https://codecov.io/gh/leonardo-marziali/agentic-development-kit)

Plugin that makes Claude Code follow an opinionated standard for
cloud-native, domain- and event-driven Java and Spring Boot services. It
formats Java with a shipped Eclipse JDT engine and checks the standard with
syntax-tree rules, [NullAway][nullaway] and [ArchUnit][archunit]. All of it
runs **outside the project's build**, and every opinion is **opt-in per
project**.

The standard itself is [standards/java-standards.md](standards/java-standards.md)
(rules J1–J24, B1–B10, S1–S58, D1–D11, T1–T7).

## What This Plugin Provides

### Opt-in per project

Nothing opinionated happens until a project commits
`.claude/java-standards.json` (`/java:setup` writes it). Without it, the
plugin only formats the lines Claude changed, and only with the project's
**own** Eclipse formatter profile, so a legacy project keeps its
conventions.

With it, `include` and `exclude` (gitignore syntax) scope the standard to
part of a repository: for example a new `v2` package next to a frozen `v1`.

### Formatting at Stop

When the session or a subagent stops, the Java files it touched are
formatted with Eclipse JDT, **only on the lines that changed** (new files
whole). The profile is, in order: the one the config names, a committed
Eclipse formatter export, `.settings/org.eclipse.jdt.core.prefs`, and — only
in an opted-in project — the plugin's [default profile](engine/default-formatter.xml).

### Java standard fix loop

In an opted-in project, the same Stop hook checks the touched files and
blocks the stop while findings remain **on lines the session changed**
(findings on older lines are listed but never block). Claude gets one
report with these sections, capped at 3 attempts per session:

- **Source rules**: about 40 checks on JDT's syntax tree (no compilation),
  each named by its rule ID. Examples: wildcard imports (J16), `@Autowired`
  (S3), `@Value("${…}")` (S4), `@Data` on entities (S15), `expression =
"java(…)"` in mappers (S21), verbs in paths (S28), and the JSpecify
  annotation rules for J20 (`@NullMarked` packages, one nullness library,
  `return null` only from `@Nullable` methods). REST path rules skip
  `@Hidden` internal endpoints (S37), and the test rules (T2, T7) check
  `*Test` classes under `src/test`.
- **Build files**: literal dependency versions (B2) and a missing Java
  version (B4) in `pom.xml` / `build.gradle(.kts)`.
- **NullAway**: the changed files compiled with javac + Error Prone +
  NullAway against the module's own classpath (J20).
- **ArchUnit**: the standard's architecture rules (S24 method vocabulary
  and one public `handle` per `*UseCase`, S7 domain-only service
  signatures, D1 domain purity, D5 `rehydrate` callers, S47 audit fields,
  S40 error advice, S6 visibility, S25 cycles) over the module's compiled
  classes, plus the project's own rules.

When a rule genuinely doesn't apply, mark the line (or the line above) with
`// java-rules:allow <ID> <reason>`. The reason is required; an allow
without one suppresses nothing and is itself a finding (J0).

A tool that can't run (no JDK, no engine, a failing build tool) prints a
warning and is skipped; it never blocks the session.

### Context digest and skills

In an opted-in project, a ~7 kB must-follow digest of the standard and its
scope is added to Claude's context at session start (again after a
compaction) and when a subagent starts.

Nine skills carry the full standard, generated from the standard file by
`scripts/build-skills.js`: `java-language-standards`,
`java-build-standards`, `spring-boot-architecture`, `mapstruct-mapping`,
`spring-rest-api-design`, `spring-data-persistence`,
`spring-boot-integrations`, `java-ddd-events`, `java-testing-standards`.
Each starts by checking the config, and tells Claude to follow the existing
code instead when the file is out of scope.

### Skills you invoke

| Skill          | What it does                                               |
| -------------- | ---------------------------------------------------------- |
| `/java:setup`  | Installs the engine, writes the config, records a baseline |
| `/java:check`  | Every finding in the given files, not just changed lines   |
| `/java:format` | Formats whole files with the project's profile             |

`/java:check` and `/java:format` take file paths, directories, globs or a
description of the files ("the files I just edited"), like
`/prettier:format`.

The plugin also depends on [`jdtls-lsp`][jdtls-lsp] for the Java language
server.

## Configuration

`.claude/java-standards.json`, committed; every key is optional:

- `include` (default `["**"]`): paths the standard covers, gitignore
  syntax from the repository root.
- `exclude` (default `[]`): paths it leaves alone, e.g. `["**/v1/"]`.
- `formatter.enabled` (`true`): format at Stop.
- `formatter.profile` (discovered): an Eclipse profile, XML export or
  `.prefs`, repository-relative.
- `formatter.scope` (`"changed-lines"`): `"file"` formats touched files
  whole.
- `checks.enabled` (`true`): the source and build-file rules.
- `checks.disabledRules` (`[]`): rule IDs to skip, e.g. `["S6"]`.
- `nullaway.enabled` (`true`): NullAway and the null-annotation rules.
- `nullaway.annotations` (`"auto"`): `"jspecify"`, `"spring"` (Boot 3.x)
  or `"auto"`.
- `archunit.enabled` (`true`): ArchUnit at Stop.
- `archunit.basePackage` (none): e.g. `"com.acme.orders"`; also enables
  the cycle check (S25).
- `archunit.packages` (the base package): packages analysed, e.g.
  `["com.acme.orders.v2.."]`.
- `archunit.disabledRules` (`[]`): ArchUnit rule IDs to skip.
- `archunit.compile` (`"auto"`): compile stale classes first — `auto`,
  `always` or `never`.
- `javaVersion` (detected): override the module's language level (`8`,
  `"1.8"`, `11`, …).

### Brownfield projects and the ArchUnit baseline

For legacy code, scope `include` / `archunit.packages` to the new code and
`exclude` the old. If the analysed packages already have ArchUnit
violations, `/java:setup` can record them in `.claude/archunit-store/`
(ArchUnit's freeze store; commit it). From then on only **new** violations
block, and fixed ones drop out of the store. The Stop hook never creates
or refreezes the store, so a session can't freeze its own violations.

Project-specific ArchUnit rules go in `.claude/archunit/*.java`: every
`public static ArchRule` field is added to the run. They are compiled and
executed at Stop, with the same trust as the project's own build.

The plugin's ArchUnit runs in its own process and classpath and ignores a
project's `archunit.properties`, so a project's own ArchUnit tests are
unaffected.

### Older Java projects

Projects from Java 8 up are supported. The plugin's tools always run on its
own JDK 21+, and each module's language level — read from `pom.xml`
(`maven.compiler.release` / `source`, `java.version`, the compiler plugin,
parent POMs) or Gradle (toolchain, `options.release`,
`sourceCompatibility`) — drives JDT, `javac --release` and which rules
apply: `var` (J13) from 10, text blocks (J14) from 15, Markdown Javadoc
(J2) from 23. Rules that need Spring Boot 3 (`RestClient`, `ProblemDetail`)
are skipped on Boot 2, and `javax.*` packages count as Boot 2's own.

The project's own Maven or Gradle (classpath resolution, compiling for
ArchUnit) runs on a JDK of the module's level, from the plugin's
`jdk_homes` option (`/config`; per user, never committed), then
`~/.m2/toolchains.xml`, then SDKMAN, mise, asdf, `/usr/lib/jvm` and macOS's
`JavaVirtualMachines`. A Lombok older than 1.18.30, which crashes JDK 21's
compiler, is replaced by the plugin's pinned Lombok for NullAway.

## Requirements and installation

```text
/plugin marketplace add leonardo-marziali/agentic-development-kit
/plugin install java@agentic-development-kit
```

- **JDK 21 or newer** on `JAVA_HOME` or `PATH` (Error Prone 2.52 needs it).
- The engine: about 40 MB of jars pinned in [engine.lock.json](engine.lock.json)
  with SHA-256 checksums, downloaded once into the plugin's data directory
  (asynchronously at session start, or by `/java:setup`):

  ```bash
  node scripts/install-engine.js              # Maven Central
  JAVA_PLUGIN_ARTIFACT_BASE_URL=https://mirror/maven2 node scripts/install-engine.js
  node scripts/install-engine.js --from-dir ./jars   # offline
  ```

- NullAway and ArchUnit use the project's Maven or Gradle wrapper (or `mvn`
  / `gradle` on `PATH`) to read the classpath and compile, without changing
  any build file. The classpath is cached per build-file hash.

## Notes

- **The Stop hook runs the project's own build.** Reading the classpath and
  compiling for ArchUnit run the project's `mvnw` / `gradlew` (or `mvn` /
  `gradle`), and `.claude/archunit/` rules are compiled and executed: build
  plugins, Gradle scripts and those rules run with your permissions, as
  they would on any build. Only opt in a project whose build you trust, or
  set `nullaway.enabled` and `archunit.enabled` to `false`.
- Stop hooks of different plugins run in parallel: the
  [editorconfig plugin](../editorconfig/README.md) may check a file while
  this one formats it. The next stop re-checks.
- Formatting changes only the lines Claude changed; `/java:format` is the
  explicit way to reformat whole files.

## Development

```bash
cd plugins/java
npm ci --ignore-scripts
npm test                    # node:test; engine tests need a JDK 21+
node scripts/build-skills.js   # after editing standards/java-standards.md
```

The engine tests install the pinned tools once into
`~/.cache/claude-java-plugin-test/`. They skip without a JDK 21+ on a dev
machine and fail in CI, which provides one.

[nullaway]: https://github.com/uber/NullAway
[archunit]: https://www.archunit.org/
[jdtls-lsp]: https://github.com/anthropics/claude-plugins-official
