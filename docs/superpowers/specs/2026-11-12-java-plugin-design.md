# Java plugin

Date: 2026-11-12

## Context

The user builds cloud-native, domain- and event-driven Spring Boot services
(Web MVC, Data JPA/Hibernate, Data MongoDB, OpenAPI generation, Camel) and has
a strict written standard for them (`java-standards.md`: J1–J24, B1–B10,
S1–S58, D1–D11, T1–T7). They want a `java` plugin that makes Claude Code
follow it, formats Java as Claude edits it, and checks the deep rules, all
without touching the project's build files.

Facts that shaped the design:

- A plugin can't ship `.claude/rules/`; a plugin-root `CLAUDE.md` isn't
  loaded; skill `paths` only permits auto-loading; hook `additionalContext` is
  capped at 10,000 characters. So guidance is layered: skills (full text) plus
  an injected digest (must-follow summary).
- The user also works on brownfield code: a legacy app where v1 is moved into
  a `v1` package and frozen, new work goes in `v2`, and small fixes on legacy
  projects that must keep their conventions. So everything opinionated is
  opt-in per project and scoped by path or package.

## Decisions (made with the user)

- **Nothing in the project's build files.** No Spotless, ArchUnit or other
  plugin added to `pom.xml` / `build.gradle`.
- **Formatter:** Eclipse JDT shipped with the plugin, run by the Stop hook,
  formatting only changed line ranges by default. A project's Eclipse
  formatter XML always wins over the plugin's default profile. IntelliJ
  dropped.
- **Source rules:** checked on the syntax tree by the same JDT engine, on
  changed lines only, blocking via ad-lfl-kit's `runFixLoop`.
- **Architecture rules:** ArchUnit shipped with the plugin, run on the
  project's compiled classes, scoped by package, with an optional freeze
  baseline for brownfield code (user's design).
- **Null-safety (J20):** JSpecify (or Spring's annotations on Boot 3.x)
  checked in two layers: annotation rules on the syntax tree, and NullAway
  flow analysis shipped with the plugin, compiling only the changed files.
- **Config:** `.claude/java-standards.json`, committed. Formatter, source
  rules, NullAway and ArchUnit can each be disabled there. Path scoping is
  gitignore-style; v1 is simply excluded.
- **Manual skills** take arguments exactly like `/prettier:format`.
- **Timing:** everything runs once at Stop/SubagentStop.
- **Java 8 and newer projects:** the tools run on the plugin's JDK 21, and
  each module's own language level drives JDT, `javac --release` and which
  rules apply. The project's own build runs on a JDK of its level, taken
  from a per-user setting or discovered, never from the committed config.

## Approaches considered

- Formatter via the project's Spotless (earlier plan): rejected — needs build
  configuration, formats whole files.
- Node regex checks: superseded — the JDT parser ships anyway, so rules run on
  a real syntax tree with far fewer heuristics.
- Checkstyle: rejected — another JVM tool, no gain over the JDT tree.
- ArchUnit inside the project's test suite: rejected — touches the build.
- Eclipse compiler (ECJ) null analysis for J20: rejected in favour of
  NullAway — ECJ ships in the JDT jars, but its JSpecify support is partial.

## Configuration — `.claude/java-standards.json`

```json
{
  "include": ["src/main/java/com/acme/orders/v2/", "src/test/java/**/v2/"],
  "exclude": ["**/v1/", "**/generated/"],
  "formatter": {
    "enabled": true,
    "profile": "config/eclipse-formatter.xml",
    "scope": "changed-lines"
  },
  "checks": {
    "enabled": true,
    "disabledRules": ["S6"]
  },
  "nullaway": {
    "enabled": true,
    "annotations": "auto"
  },
  "archunit": {
    "enabled": true,
    "basePackage": "com.acme.orders",
    "packages": ["com.acme.orders.v2.."],
    "disabledRules": ["S24"],
    "compile": "auto"
  }
}
```

- `include` / `exclude`: gitignore semantics relative to the repo root (no
  slash → any segment, trailing `/` → directory, `!` negation, last match
  wins), built on `path.matchesGlob`. Default: whole repo, nothing excluded.
  They scope the formatter and the source rules. ArchUnit uses `packages`.
- `formatter.profile`: optional. If unset, the plugin looks for an Eclipse
  formatter XML in the project (a `<profiles kind="CodeFormatterProfile">`
  file, or `.settings/org.eclipse.jdt.core.prefs`). Found → used. Not found →
  the plugin's default profile (the user's style).
- `formatter.scope`: `changed-lines` (default) or `file`.
- `nullaway.annotations`: `auto` (JSpecify if `org.jspecify` is on the
  classpath, Spring's `org.springframework.lang` on Boot 3.x without it),
  `jspecify` or `spring`. NullAway's annotated packages default to
  `archunit.basePackage`.
- **No config file at all:** no digest, no checks, no NullAway, no ArchUnit.
  The formatter
  runs only if the project has its own Eclipse XML, on changed lines, so a
  legacy project without one is never restyled.
- `javaVersion`: optional override of the detected language level (`8`,
  `"1.8"`, `11`, …).
- Malformed JSON → stderr warning, treated as absent.

### Older Java projects (8, 11, …)

- **Language level per module**, detected from the build file: Maven
  `maven.compiler.release`, `maven.compiler.source`, `java.version`, then the
  compiler plugin's `<release>` / `<source>` (properties and parent POMs
  resolved); Gradle toolchain `languageVersion`, `options.release`,
  `sourceCompatibility`. `javaVersion` in the config overrides it; nothing
  found → 17 with a note.
- The level is passed to JDT (`--source`) and to `javac --release` for
  NullAway (verified with `--release 8` and `11` on JDK 21;
  `-Xlint:-options` silences the obsolete-option warnings).
- **Rules gated by level:** J13 `var` (10+), J14 text blocks (15+), J15
  records and `instanceof` patterns (16+), `sealed` (17+), J2 Markdown
  Javadoc (23+). Below the level they're neither checked nor suggested.
- **Rules gated by Spring Boot version** (detected from the parent POM, BOM
  import or Gradle plugin): S57 `RestClient` (Boot 3.2+), S40/S42
  `ProblemDetail` (Boot 3+). D1 and the null-annotation rules also accept
  Boot 2's `javax.*` packages.
- **Build JDK:** the project's own Maven/Gradle (dependency classpath,
  compile before ArchUnit) runs with a JDK whose major version matches the
  module's level, from the plugin's per-user `jdk_homes` option, then
  `~/.m2/toolchains.xml`, then SDKMAN / mise / asdf / `/usr/lib/jvm` /
  macOS `JavaVirtualMachines`. None found → the plugin's JDK, with a note.
- **Lombok fallback:** Lombok before 1.18.30 crashes JDK 21's `javac`
  (verified with 1.18.22), so the plugin pins Lombok 1.18.48 and uses it on
  the NullAway processor path in that case, with a note.

## Shipped engine

```text
plugins/java/
├── engine.lock.json          JDT, ArchUnit, Error Prone + NullAway jars
├── engine/
│   ├── jdt/                  Format + source-rule engine (Java source)
│   └── archunit/             Runner + StandardRules (Java source)
└── scripts/install-engine.js Downloads jars, compiles engine sources
```

- Same pattern as the sonarqube plugin (`sloop.lock.json`,
  `scripts/install-sloop.js`, `cli/provision.js`): jars are downloaded once
  from Maven Central (or a mirror env var, or `--from-dir` offline) into
  `${CLAUDE_PLUGIN_DATA}`, checksums verified, nothing half-installed left
  active.
- The engine's Java sources are compiled once per plugin version with the
  local JDK's `javac` into the data dir.
- Install runs from `/java:setup` and asynchronously at SessionStart when
  missing. A missing engine or JDK at Stop → stderr warning, skip, never
  block.
- One JVM per stop for format + source rules; one `javac` run for NullAway;
  one JVM for ArchUnit when it runs.

## Behavior

### Context digest (SessionStart + SubagentStart)

With a config present, inject a ~6–8 kB must-follow digest of the standard,
the scope globs, and "out of scope → follow the surrounding code". SessionStart
also fires after compaction; SubagentStart covers subagents. No config →
nothing injected. A test keeps the digest under 9,500 characters.

### Skills

Model-invoked, `paths: "**/*.java, **/pom.xml, **/build.gradle*"`. Each starts
by reading the config: missing, or file out of scope → follow the existing
code instead.

| Skill                      | Sections                                  |
| -------------------------- | ----------------------------------------- |
| `java-language-standards`  | J1–J24                                    |
| `java-build-standards`     | B1–B10 (Maven + Gradle)                   |
| `spring-boot-architecture` | S1–S12, S25 (layers, services, packages)  |
| `mapstruct-mapping`        | S13–S24 (models, mappers, vocabulary)     |
| `spring-rest-api-design`   | S26–S43 (REST, PATCH, OpenAPI, errors)    |
| `spring-data-persistence`  | S44–S53 (JPA, MongoDB, auditing, queries) |
| `spring-boot-integrations` | S54–S58 (cache, Logbook, HTTP, retries)   |
| `java-ddd-events`          | D1–D11                                    |
| `java-testing-standards`   | T1–T7                                     |

No Camel skill until the standard covers Camel.

User-invoked (`disable-model-invocation: true`):

- `/java:setup` — installs the engine, writes `.claude/java-standards.json`
  (whole repo for a new project; asks include/exclude and `packages` for a
  brownfield one), and optionally creates the ArchUnit freeze baseline.
- `/java:format` — formats whole files with the discovered profile, then
  reports `git diff --stat`.
- `/java:check` — source rules, NullAway and ArchUnit on whole files (all
  findings, not just changed lines).

Both use the `/prettier:format` argument contract
(`argument-hint: '[file paths...] | [natural-language description of files
to include]'`):

- no arguments → the whole project, minus `exclude` and `.gitignore`;
- literal files, directories or globs → exactly those, each verified first,
  and a path that matches nothing is named rather than skipped;
- a natural-language description → resolved to concrete paths via
  `git status` / `git diff` and listings; if ambiguous, list candidates with
  a one-line reason each and ask before running.

### Stop / SubagentStop hook

1. Collect tracked `.java` and build files via `trackSessionChanges`.
2. **Format** in-scope `.java` files (or, without config, only where a
   project XML exists): changed ranges from ad-lfl-kit's
   `changedRangesByFile` passed to JDT `CodeFormatter.format(kind, source,
regions, …)`, or the whole file with `scope: file`. Formatting never
   blocks.
3. **Source rules** (JDT syntax tree), findings on changed lines block,
   older ones are listed but don't block (`scopesFor` / `partitionByScope`).
4. **NullAway** on the in-scope changed `.java` files (see below); findings
   on changed lines block.
5. **ArchUnit** (if enabled and the session touched `.java` files):
   compile per `compile`, run `StandardRules` + project rules on the classes
   in `packages`, freeze-filtered.
6. One `runFixLoop`: one attempt counter, one report with sections
   (source rules, NullAway, ArchUnit). Timeout 180 s.

Suppression of a source finding: `// java-rules:allow <ID> <reason>` on the
line or the line above; a missing reason is itself a finding.

### Source rules (JDT syntax tree, no type resolution)

Things only the source shows: J16 wildcard imports (the formatter doesn't
change imports) · J1 `@author`/`@version` · J2 mixed `///` and `/**` · J3
consecutive `//` lines · J9 member order · J13 `var` with a non-`new`,
non-literal initializer · J14 multi-line concatenation → text block · J20
`Optional` field/parameter · S2 `LoggerFactory` · S3 `@Autowired` · S4
`@Value("${…}")` · S14 `@Data` on `*ReadDto` · S15 Lombok `@Data` /
`@EqualsAndHashCode` / `@ToString` on `@Entity`, `@Id`/`@Version`/audit field
without `@Setter(AccessLevel.NONE)` · S21 `expression = "java(` and
`private` mapper helpers · S22 `@Mapper` interface · S28/S30 verb path
segments, bare `{id}` · S42 `getMessage()` into `ProblemDetail` · S46
legacy date types in `@Entity` · S50 `nativeQuery` without a comment · S57
`RestTemplate`/`WebClient` · B6 unmatched `@formatter:off` · T2 JUnit
`Assertions`, non-`should…When…` names · T7 `ReflectionTestUtils.setField`,
mocked `*Dto`.

Null annotation rules (J20, same engine): every in-scope package has a
`package-info.java` with `@NullMarked` (Spring: `@NonNullApi` +
`@NonNullFields`) · one nullness library per project · no Lombok `@NonNull`,
Bean Validation `@NotNull`, `javax.annotation` / `jakarta.annotation` used as
nullness markers · `return null;` only in methods whose return type is
`@Nullable` · JSpecify `@Nullable` placed as a type-use annotation.

Build-file checks in Node: B2 literal dependency versions, B4 missing Java
version.

### NullAway (J20 flow analysis)

- **Classpath without touching the build:** Maven `mvnw -q
dependency:build-classpath -Dmdep.outputFile=…`; Gradle via an init script
  printing `compileClasspath` (the editorconfig plugin already injects an
  init script, `narrow-includes.gradle`). Cached in the session state dir,
  keyed by a hash of the module's build files.
- **Compile:** `javac` with Error Prone as a plugin, `-XepDisableAllChecks
-Xep:NullAway:ERROR`, `OnlyNullMarked=true` for JSpecify or
  `AnnotatedPackages=<basePackage>` for Spring annotations, the required
  `-J--add-exports` flags, output to a temp dir. Only the changed files are
  sources; `target/classes` and the dependency classpath resolve the rest.
- **Annotation processors:** Lombok and MapStruct taken from the project's
  classpath onto the processor path (Lombok first), so generated accessors
  exist when NullAway runs.
- Only NullAway diagnostics count; other compile errors are left to jdtls and
  never block. No classpath or a failed resolution → warning, skip.

### ArchUnit (user's design)

- **Rules** in `engine/archunit/StandardRules.java`: S24 vocabulary, S7/S12
  service and repository signatures (no `*Dto`/`*Entity`), D1 domain purity,
  D5 `rehydrate` callers only in mappers, S47 every `@Entity` has an
  `AuditEmbeddable` field, S40 single advice extending
  `ResponseEntityExceptionHandler`, S6/S17 visibility, layering, no package
  cycles. Rules refer to annotations and types by **name strings**
  (`areAnnotatedWith("org.mapstruct.Mapper")`), so they compile against
  ArchUnit alone.
- **Classes:** the runner walks each module for `target/classes`,
  `target/test-classes`, `build/classes/java/{main,test}`.
- **`compile`:** `auto` compiles a module only when a tracked source is newer
  than its class output (`mvnw -q compile test-compile` / `gradlew -q classes
testClasses`, wrapper found like editorconfig's `jvmBin`); `always`;
  `never` (stale or missing classes → skip with a note). A failed compile is
  reported but doesn't block, since the compiler errors are Claude's to see
  via jdtls.
- **Scope:** `packages` replaces line scoping; `disabledRules` by rule ID.
- **Freeze baseline:** if `.claude/archunit-store/` exists, every rule is
  wrapped in `FreezingArchRule` with that store. The hook never creates or
  refreezes it (`allowStoreCreation=false`, `refreeze=false`), so a session
  can't freeze its own violations; `/java:setup` creates it deliberately.
  Fixed violations drop out of the store automatically.
- **Project rules:** `.claude/archunit/*.java`, if present, compiled against
  the ArchUnit jars and added to the run.
- **Coexisting with the project's own ArchUnit tests:** separate process and
  classpath, nothing in `src/test`. The runner sets ArchUnit's configuration
  programmatically, so a project `archunit.properties` found in
  `test-classes` can't redirect the store or change behavior.

## Files

New `plugins/java/`, modelled on `plugins/python/`,
`plugins/editorconfig/` and `plugins/sonarqube/`:

- `.claude-plugin/plugin.json` — `name: java`, `0.1.0`,
  `dependencies: ["jdtls-lsp@claude-plugins-official"]`.
- `hooks/hooks.json` — SessionStart (digest, async engine install),
  SubagentStart (digest), PreToolUse/PostToolUse/PostToolUseFailure
  (tracking, same matchers as python), Stop/SubagentStop (loop, 180 s).
- `engine.lock.json`, `engine/jdt/*.java`, `engine/archunit/*.java`,
  `engine/default-formatter.xml`.
- `scripts/install-engine.js`, `scripts/check.js` (CLI for `/java:check`),
  `scripts/hooks/` (`track-touched`, `check-and-loop`, `inject-digest`,
  `lib`, `config`, `engine`),
  `scripts/hooks/digest.md`.
- `scripts/hooks/__tests__/*.test.js` (node:test): config parsing and
  gitignore matching, formatter-profile discovery, engine command building
  and output parsing (JVM stubbed), loop integration, digest size. Java-side
  tests: per-rule fixture files run by a test that invokes the compiled
  engine when a JDK is available (skipped otherwise).
- `skills/*/SKILL.md` — 9 guidance + `setup`, `check`, `format`.
- `package.json` + `package-lock.json`, pinning the published ad-lfl-kit.
- `README.md`.

Repo wiring: `.claude-plugin/marketplace.json` entry;
`.github/workflows/plugin-tests.yml` path filter + matrix line (with a
`setup-java` step for the engine tests); root `README.md`;
`docs/superpowers/specs/2026-11-12-java-plugin-design.md` committed first.
Branch `feat/java-plugin`, PR via `github:pr`.

## Reuse

- ad-lfl-kit: `readHookInput`, `stateDir`, `loopStateDir`,
  `readTrackedFiles`, `trackSessionChanges`, `changedRangesByFile`,
  `scopesFor`, `partitionByScope`, `runBin`, `resolveBin`, `runFixLoop`.
- Tracking and loop shape: `plugins/python/scripts/hooks/`.
- JVM wrapper walk-up, timeouts:
  `plugins/editorconfig/scripts/hooks/backends.js`.
- Pinned-jar install: `plugins/sonarqube/` (`sloop.lock.json`,
  `cli/provision.js`, `scripts/install-sloop.js`).

## Builder notes

- Pick the JDT version whose runtime Java requirement matches the minimum
  JDK the plugin supports (17 or 21); resolve its exact jar set
  (`org.eclipse.jdt.core`, `org.eclipse.text`, `org.eclipse.core.runtime`,
  equinox and osgi bundles) from its POM and pin each one.
- Pick an ArchUnit version that reads the class-file versions of current
  JDKs; ArchUnit's only runtime dependency is `slf4j-api`.
- Pin Error Prone + NullAway versions that run on the supported JDK, and the
  full transitive jar set of `error_prone_core`. Check how NullAway treats
  Spring's `@NonNullApi` (it may need `AnnotatedPackages` rather than reading
  the package annotation) and confirm on a Boot 3 fixture.
- Lombok + Error Prone on one processor path is a known ordering pitfall;
  verify generated getters are visible to NullAway.
- Spawning the build tool for `compile: auto` is the slowest step; keep it
  inside the 180 s Stop timeout and say so when it's skipped.
- Stop hooks of different plugins run in parallel (editorconfig may check a
  file while this one formats it); the next stop rechecks. Document it.
- Running `.claude/archunit/` rules executes project code at Stop — same
  trust as the project's own build; document it in the README.

## Verification

- `cd plugins/java && pnpm test` and `pnpm test:coverage`.
- `claude plugin validate plugins/java --strict`.
- `node scripts/install-engine.js` on linux-arm64 (this container): jars
  verified, engine compiled.
- Fixture Maven and Gradle Spring Boot projects in the scratchpad, session
  with `--plugin-dir plugins/java`:
  - bad edit → Stop formats only the edited lines and blocks on a source rule;
  - a service method returning an `*Entity` → ArchUnit blocks; fixed → passes;
  - a `@NullMarked` package where a `@Nullable` value reaches a non-null
    parameter → NullAway blocks; same on a Boot 3 fixture with Spring
    annotations; a Lombok `@Getter` class compiles cleanly;
  - with `.claude/archunit-store/` from `/java:setup`, pre-existing
    violations don't block, a new one does;
  - a project with its own ArchUnit test and `archunit.properties` → both
    still work, store untouched.
- Brownfield: no config → no digest/checks, no formatting without a project
  XML; `include`/`packages` = v2 → edits under `v1` never block.
