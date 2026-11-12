# Java Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `java` plugin that formats Java with a shipped Eclipse JDT
engine, blocks a session on violations of the user's Java standard (source
rules, NullAway, ArchUnit), and teaches the standard through skills and an
injected digest — all opt-in per project and outside the project's build.

**Architecture:** Node hooks (ad-lfl-kit tracking + `runFixLoop`) orchestrate
three JVM tools installed from pinned jars into `${CLAUDE_PLUGIN_DATA}`: a JDT
engine (ranged formatting + syntax-tree rules), `javac` with Error Prone +
NullAway, and an ArchUnit runner. Node and the JVM tools talk through a
tab-separated line protocol, so neither side needs a JSON library.

**Tech Stack:** Node ≥ 22 (`node:test`), `@leonardo-marziali/ad-lfl-kit`
2.12.0, JDK 21, Eclipse JDT core 3.47.0, Error Prone 2.52.0, NullAway 0.14.3,
ArchUnit 1.5.1.

**Spec:** `docs/superpowers/specs/2026-11-12-java-plugin-design.md`

## Global Constraints

- Plugin `dependencies`: only `@leonardo-marziali/ad-lfl-kit` pinned to
  `2.12.0`, with a `package-lock.json` from `npm install
--package-lock-only` (AGENT.md). No other npm runtime dependency.
- Never edit a project's `pom.xml` / `build.gradle(.kts)`.
- Runtime JDK ≥ 21 (Error Prone 2.52 refuses older). JDK missing or older →
  one stderr warning, the JVM steps are skipped, the stop is never blocked.
- Projects from Java 8 up are supported. The tools always run on the
  plugin's JDK ≥ 21; each module's language level (Task 3b) goes to JDT
  (`--source`) and `javac --release`, and gates rules that need newer syntax.
- The project's own Maven/Gradle runs with the JDK Task 3b picks for the
  module's level (per-user `jdk_homes`, then discovery), not necessarily
  the plugin's JDK.
- Any tool failure (download, JVM crash, build tool, parse error) warns on
  stderr and never blocks. Only findings block.
- Stop / SubagentStop hook timeout: `180` seconds.
- Config file: `<repo root>/.claude/java-standards.json`. Missing → no
  digest, no rules, no NullAway, no ArchUnit; formatting only when the
  project has its own Eclipse profile.
- Suppression comment: `// java-rules:allow <ID> <reason>` on the finding's
  line or the line above; no reason → finding `J0` "suppression needs a
  reason".
- Rule IDs are the standard's own (`J16`, `S4`, `D1`, …).
- Commits follow Conventional Commits, scope `java`
  (e.g. `feat(java): …`, `test(java): …`).
- Skill names follow AGENT.md: domain/tool prefix for guidance skills, bare
  verbs (`setup`, `check`, `format`) for user-invoked ones.

## Pinned artifacts (verified on Maven Central, 2026-11-12)

JDT engine (all 11 are required; `org.eclipse.core.commands` is not):

- `org.eclipse.jdt:org.eclipse.jdt.core:3.47.0`
- `org.eclipse.jdt:ecj:3.46.100`
- `org.eclipse.platform:org.eclipse.core.resources:3.24.100`
- `org.eclipse.platform:org.eclipse.core.runtime:3.35.0`
- `org.eclipse.platform:org.eclipse.core.contenttype:3.9.900`
- `org.eclipse.platform:org.eclipse.core.jobs:3.15.900`
- `org.eclipse.platform:org.eclipse.equinox.common:3.21.0`
- `org.eclipse.platform:org.eclipse.equinox.preferences:3.12.100`
- `org.eclipse.platform:org.eclipse.osgi:3.24.300`
- `org.eclipse.platform:org.eclipse.text:3.14.800`
- `org.osgi:org.osgi.service.prefs:1.1.2`

NullAway: `com.google.errorprone:error_prone_core:2.52.0` +
`com.uber.nullaway:nullaway:0.14.3` and their 25 transitive jars (resolve
the exact list with `mvn dependency:copy-dependencies` on a two-dependency
POM, as in Task 4 Step 3). ArchUnit: `com.tngtech.archunit:archunit:1.5.1`,
`org.slf4j:slf4j-api:2.0.19`, `org.slf4j:slf4j-nop:2.0.19`. Lombok
fallback: `org.projectlombok:lombok:1.18.48`, used on the NullAway processor
path when the project's Lombok is older than `1.18.30` (older Lombok crashes
JDK 21's `javac` with `NoSuchFieldError: … JCImport … qualid`, spike
2026-11-12).

Proven `javac` invocation for NullAway on JDK 21 (spike, 2026-11-12):

```text
javac -J--add-exports=jdk.compiler/com.sun.tools.javac.{api,file,main,model,
        parser,processing,tree,util,code,comp}=ALL-UNNAMED
      -J--add-opens=jdk.compiler/com.sun.tools.javac.{code,comp}=ALL-UNNAMED
      -XDcompilePolicy=simple --should-stop=ifError=FLOW
      -XDaddTypeAnnotationsToSymbol=true -proc:full -implicit:none
      --release <module level> -Xlint:-options
      -processorpath <lombok>:<mapstruct-processor>:<error prone jars>
      -cp <project classes>:<dependency classpath> -d <tmp>
      "-Xplugin:ErrorProne -XepDisableAllChecks -Xep:NullAway:ERROR
        -XepOpt:NullAway:OnlyNullMarked=true -XepOpt:NullAway:JSpecifyMode=true"
      <changed files>
```

(one `-J--add-exports` per package; brace lists shown compactly here.)
Output lines: `<file>:<line>: error: [NullAway] <message>`.

## Review Focus

- **A file with syntax errors** (Claude mid-refactor): the engine reports
  `ERROR` for that file, formats and rule-checks the others, and the stop is
  not blocked on the broken file → Task 5 and Task 10 tests.
- **CRLF files:** formatting keeps the file's own line separator and ranged
  offsets stay correct → Task 5 test.
- **No JDK, or JDK 17:** one warning, no block, tracked state still cleaned
  up → Task 10 test.
- **A project with neither JSpecify nor Spring nullness annotations on the
  classpath:** NullAway `auto` skips with a note instead of reporting every
  dereference → Task 12 test.
- **Files outside a git repository:** `scopesFor` treats the whole file as
  changed, so findings block; the formatter formats the whole file only when
  `scope: file`, otherwise it formats nothing (no ranges known) → Task 10
  test.

---

## Phase 1 — Plugin foundation

### Task 1: Scaffold, config loading and scope matching

**Files:**

- Create: `plugins/java/.claude-plugin/plugin.json`,
  `plugins/java/package.json`, `plugins/java/package-lock.json`,
  `plugins/java/scripts/hooks/config.js`,
  `plugins/java/scripts/hooks/__tests__/config.test.js`,
  `plugins/java/scripts/hooks/__tests__/helpers.js`
- Modify: `.claude-plugin/marketplace.json`,
  `.github/workflows/plugin-tests.yml`

**Interfaces:**

- Produces:
  - `loadConfig(repoRoot: string): Config | null` — `null` when the file is
    absent or malformed (malformed also writes one stderr warning).
  - `Config` = `{ include: string[], exclude: string[], formatter: {
enabled: boolean, profile: string|null, scope: 'changed-lines'|'file' },
checks: { enabled: boolean, disabledRules: string[] }, nullaway: {
enabled: boolean, annotations: 'auto'|'jspecify'|'spring' }, archunit: {
enabled: boolean, basePackage: string|null, packages: string[],
disabledRules: string[], compile: 'auto'|'always'|'never' }, javaVersion:
number|null }`, defaults
    filled (`include: ['**']`, everything `enabled: true`, `scope:
'changed-lines'`, `annotations: 'auto'`, `compile: 'auto'`).
  - `isInScope(absPath: string, config: Config, repoRoot: string): boolean`.
  - `findRepoRoot(startPath: string): string | null` (walks up to `.git`).
  - `CONFIG_RELATIVE_PATH = '.claude/java-standards.json'`.
  - helpers.js: `mkScratchDir`, `rmScratchDir`, `uniqueSessionId`,
    `runHook(scriptName, stdinObj, { env })` — copy
    `plugins/python/scripts/hooks/__tests__/helpers.js`, minus the
    ruff/pyright parts.

- [ ] **Step 1: Write the failing tests** in `config.test.js`:
  - `loadConfig` on a dir without the file → `null`.
  - malformed JSON → `null` and stderr contains `java plugin:`.
  - `{}` → every default listed above.
  - `isInScope` with `include: ['src/main/java/com/acme/orders/v2/']`,
    `exclude: ['**/v1/']`: `src/main/java/com/acme/orders/v2/A.java` → true,
    `src/main/java/com/acme/orders/v1/A.java` → false,
    `src/main/java/com/acme/orders/v2/v1/A.java` → false.
  - `javaVersion: "1.8"` → `8`, `11` → `11`, `"abc"` → `null` plus a
    warning.
  - gitignore semantics: pattern `generated/` matches
    `a/generated/B.java`; `!src/keep/` after `src/` re-includes
    `src/keep/K.java`; last match wins; Windows-style separators in
    `absPath` are normalised.
- [ ] **Step 2: Run** `cd plugins/java && npm ci --ignore-scripts && node
--test scripts/hooks/__tests__/config.test.js` → FAIL (module missing).
- [ ] **Step 3: Implement `config.js`.** Gitignore matching: convert each
      pattern to a `path.posix.matchesGlob` glob (no slash → `**/<p>`, trailing
      `/` → `<p>**`, leading `/` → anchored), evaluate in order, `!` flips the
      result, last match wins; the path is made repo-relative and posix first.
- [ ] **Step 4: Scaffold.** `plugin.json`: name `java`, version `0.1.0`,
      description "Java standards for Claude Code: Eclipse JDT formatting,
      source rules, NullAway and ArchUnit checks at Stop, and standards skills —
      opt-in per project.", author/homepage/repository/license as in
      `plugins/python/.claude-plugin/plugin.json`, `dependencies:
["jdtls-lsp@claude-plugins-official"]`, and `userConfig.jdk_homes` (`type:
string`, `multiple: true`, title "JDK homes for project builds",
      description "JDKs the plugin may use to run your projects' own Maven or
      Gradle, e.g. a Java 8 and a Java 11 home. Picked by the module's Java
      version.", not required). `package.json`: name
      `java-plugin-tests`, `private`, the kit dependency, `test` and
      `test:coverage` scripts copied from `plugins/python/package.json` but
      globbing `scripts/**/__tests__/*.test.js`. Generate the lockfile with
      `npm install --package-lock-only`. Marketplace entry: category `quality`,
      keywords `["java", "spring-boot", "formatting", "nullaway", "archunit",
"jspecify"]`. CI: add a `java` path filter (`plugins/java/**`) and an
      `add "java" "plugins/java" "java-plugin"` matrix line next to python's,
      plus an `actions/setup-java` step (Temurin 21) when `matrix.suite.name ==
'java'`.
- [ ] **Step 5: Run** the test → PASS; `claude plugin validate plugins/java`
      → `Validation passed`.
- [ ] **Step 6: Commit** `feat(java): scaffold plugin with project config
and scope matching`.

### Task 2: Session tracking hook

**Files:**

- Create: `plugins/java/hooks/hooks.json`,
  `plugins/java/scripts/hooks/lib.js`,
  `plugins/java/scripts/hooks/track-touched.js`,
  `plugins/java/scripts/hooks/__tests__/track-touched.test.js`

**Interfaces:**

- Consumes: ad-lfl-kit `readHookInput`, `stateDir`, `trackSessionChanges`.
- Produces (`lib.js`): `STATE_NAMESPACE = 'java-plugin'`, `TOUCHED_FILES =
'touched-files.txt'`, `isJavaFile(p)`, `isBuildFile(p)` (`pom.xml`,
  `build.gradle`, `build.gradle.kts`), `isTrackable(p)` = either and not
  under `node_modules`, `.git`, `target`, `build`, `.gradle`.

- [ ] **Step 1: Write failing tests** mirroring
      `plugins/python/scripts/hooks/__tests__/track-touched.test.js`: an Edit of
      `src/A.java` is recorded; `pom.xml` is recorded; `target/gen/B.java` and
      `README.md` are not; a Bash call that writes `src/C.java` (PreToolUse then
      PostToolUse) is recorded.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `lib.js` and `track-touched.js` (same body as
      python's, with `isTrackable`). `hooks.json`: PreToolUse
      `Bash|PowerShell|mcp__.*`, PostToolUse
      `Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell|mcp__.*`,
      PostToolUseFailure `Bash|PowerShell|mcp__.*` → `track-touched.js`. (Later
      tasks add SessionStart, SubagentStart, Stop, SubagentStop.)
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(java): track Java and build files a session
touches`.

### Task 3: Context digest

**Files:**

- Create: `plugins/java/scripts/hooks/digest.md`,
  `plugins/java/scripts/hooks/inject-digest.js`,
  `plugins/java/scripts/hooks/__tests__/inject-digest.test.js`
- Modify: `plugins/java/hooks/hooks.json` (SessionStart, SubagentStart →
  `inject-digest.js`, `async: false`)

**Interfaces:**

- Consumes: `loadConfig`, `findRepoRoot` (Task 1).
- Produces: hook stdout `{"hookSpecificOutput": {"hookEventName":
"<event>", "additionalContext": "<digest>"}}`.

- [ ] **Step 1: Write failing tests:** no config → empty stdout; config →
      JSON whose `additionalContext` contains the include/exclude lines, the
      sentence "Outside these paths, follow the conventions of the surrounding
      code instead of this standard.", and `J16`; `hookEventName` echoes
      `SessionStart` / `SubagentStart`; `digest.md` plus scope block is under
      `9500` characters.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Write `digest.md`** — one imperative line per rule the user
      must not break, grouped by section (Java, Build, Spring Boot, DDD/events,
      Testing), each prefixed with its ID, pointing to the skills for detail.
      Source: the user's standard, copied into the repo as
      `plugins/java/standards/java-standards.md` in this step (from
      `/home/node/.claude/uploads/cd194129-47cd-42fc-ae09-454845a8a67f/9bd6af32-java-standards.md`).
      Implement `inject-digest.js` (cwd from hook input → repo root → config).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(java): inject the standards digest into
opted-in sessions`.

### Task 3b: Module language level, Spring Boot version and build JDK

**Files:**

- Create: `plugins/java/scripts/hooks/module.js`,
  `plugins/java/scripts/hooks/__tests__/module.test.js`

**Interfaces:**

- Consumes: `Config.javaVersion` (Task 1).
- Produces:
  - `detectJavaLevel(moduleRoot: string): number | null`. Maven, first hit
    wins: `maven.compiler.release`, `maven.compiler.source`, `java.version`
    properties, then `maven-compiler-plugin` `<release>` / `<source>`;
    `${prop}` resolved from the same POM's `<properties>`, then parent POMs
    reached by `<relativePath>` (default `../pom.xml`) inside the repo.
    Gradle (`build.gradle(.kts)`): `languageVersion = JavaLanguageVersion.of(N)`,
    `options.release = N` / `.set(N)`, `sourceCompatibility =
JavaVersion.VERSION_1_8 | '1.8' | 11`. `1.N` → `N`.
  - `detectSpringBoot(moduleRoot: string): { major, minor } | null` — Maven
    `spring-boot-starter-parent` parent or imported `spring-boot-dependencies`
    BOM version; Gradle `id("org.springframework.boot") version "x.y.z"` /
    `id 'org.springframework.boot' version 'x.y.z'`.
  - `moduleInfo(moduleRoot, config): { javaLevel: number, boot: {major,
minor} | null }` — `javaLevel` = `config.javaVersion ?? detected ?? 17`,
    the fallback with one stderr note "could not detect the Java version of
    MODULE; assuming 17 — set javaVersion in .claude/java-standards.json".
  - `buildJavaHome(level: number): string | null` — first JDK whose
    `release` file `JAVA_VERSION` major equals `level`, searched in: the
    `jdk_homes` user option (`CLAUDE_PLUGIN_OPTION_JDK_HOMES`), then
    `~/.m2/toolchains.xml` `<jdk>` entries with that `<version>`, then
    `~/.sdkman/candidates/java/*`, `~/.local/share/mise/installs/java/*`,
    `~/.asdf/installs/java/*`, `/usr/lib/jvm/*`,
    `/Library/Java/JavaVirtualMachines/*/Contents/Home`. `null` → callers run
    the build with the plugin's JDK and add the note "no JDK LEVEL found;
    ran MODULE's build on JDK N".

- [ ] **Step 1: Write failing tests** with fixture POMs and Gradle files:
      `<maven.compiler.release>11</…>` → 11; `<java.version>1.8</…>` → 8;
      property indirection `${jdk.level}` → resolved; level only in the parent
      POM → found; compiler plugin `<source>1.8</source>` → 8; Gradle toolchain
      `of(17)` → 17, `JavaVersion.VERSION_1_8` → 8; nothing → `null`, and
      `moduleInfo` → 17 with the note; `config.javaVersion: 11` overrides a
      detected 17; Boot parent `2.7.18` → `{2, 7}`, Gradle plugin `3.3.5` →
      `{3, 3}`. `buildJavaHome`: fake JDK dirs with `release` files under a temp
      `HOME` (and the env option as a JSON array and as a comma list) → the
      matching one; none → `null`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with line-oriented scanning (no XML parser).
      Check how Claude Code exports a `multiple: true` option in
      `CLAUDE_PLUGIN_OPTION_JDK_HOMES` and accept that form (the test covers
      JSON array and comma list until confirmed).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(java): detect module Java level, Spring Boot
version and build JDK`.

## Phase 2 — JDT engine: install, format, source rules, Stop loop

### Task 4: Pinned engine install

**Files:**

- Create: `plugins/java/engine.lock.json`,
  `plugins/java/scripts/provision.js`,
  `plugins/java/scripts/install-engine.js`,
  `plugins/java/scripts/__tests__/provision.test.js`
- Modify: `plugins/java/hooks/hooks.json` (SessionStart, `async: true`,
  timeout 300 → `install-engine.js --if-missing --quiet`)

**Interfaces:**

- Produces:
  - `engine.lock.json` (groups `jdt`, `errorprone`, `archunit`, `lombok`):
    `{ "minJava": 21, "groups": { "jdt": [...],
"errorprone": [...], "archunit": [...] } }`, each entry `{ groupId,
artifactId, version, sha256 }`.
  - `install({ dataDir, fromDir?, baseUrl? }): Promise<Manifest>`;
    `readInstall(dataDir): Manifest | null`;
    `Manifest = { version, javaBin, javaMajor, jars: { jdt: string[],
errorprone: string[], archunit: string[], lombok: string[] }, classes: { jdt: string,
archunit: string } }`, written to `<dataDir>/engine/install.json` only
    after every jar is verified and both engines compiled.
  - `findJava(): { bin, major } | null` (JAVA_HOME, then PATH).
  - `engineDataDir()` = `${CLAUDE_PLUGIN_DATA}/engine` (tests pass
    `dataDir`).
  - CLI: `install-engine.js [--data-dir d] [--from-dir d] [--if-missing]
[--quiet]`, exit 0 installed / 2 failed; mirror URL env
    `JAVA_PLUGIN_ARTIFACT_BASE_URL`.

- [ ] **Step 1: Write failing tests** (copy the shape of
      `plugins/sonarqube/cli/__tests__/provision.test.js`): install from a
      `--from-dir` of fake jars with matching checksums (test lock passed in)
      writes the manifest; a checksum mismatch deletes the file, writes no
      manifest and rejects; `--if-missing` with an existing manifest for the
      same plugin version does nothing; `findJava` returning major 17 →
      `install` rejects with "JDK 21 or newer is required".
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** by adapting `plugins/sonarqube/cli/provision.js`
      (download, `sha256File`, `verifyChecksum`, `obtain`) — no archive
      extraction, jars only. After the jars, compile `engine/jdt/src/**` and
      `engine/archunit/src/**` with `javac --release 21 -d
<dataDir>/engine/classes/<name> -cp <group jars>` (these sources arrive in
      Tasks 5 and 13; compile whichever directories exist). Fill
      `engine.lock.json` with the pinned jars above (resolve the Error Prone +
      NullAway closure with `mvn dependency:copy-dependencies` on a POM
      declaring only those two); compute each sha256 from a
      download whose Maven Central `.sha1` matched.
- [ ] **Step 4: Run** tests → PASS; then `node
scripts/install-engine.js` in this container → exit 0, manifest present.
- [ ] **Step 5: Commit** `feat(java): install pinned JDT, Error Prone and
ArchUnit jars`.

### Task 5: Engine protocol and ranged formatter

**Files:**

- Create: `plugins/java/engine/jdt/src/dev/adk/java/engine/Main.java`,
  `.../Request.java`, `.../Formatter.java`, `.../Profiles.java`,
  `plugins/java/engine/default-formatter.xml`,
  `plugins/java/scripts/hooks/engine.js`,
  `plugins/java/scripts/hooks/profile.js`,
  `plugins/java/scripts/hooks/__tests__/engine.test.js`,
  `plugins/java/scripts/hooks/__tests__/profile.test.js`,
  `plugins/java/scripts/hooks/__tests__/fixtures/format/*`

**Interfaces:**

- Request file (UTF-8, one line per file, tab-separated):
  `<abs path>\t<ranges>` where `<ranges>` is `*` (whole file), `-` (don't
  format), or `start-end,start-end` (1-based inclusive lines).
- `java -cp <classes>:<jdt jars> dev.adk.java.engine.Main --request <file>
[--profile <xml-or-prefs>] [--rules on|off] [--disabled ID,ID]
[--source <level>] [--boot <major.minor>|none]`; `<level>` and
  `--boot` come from Task 3b's `moduleInfo`, per module.
- Output lines on stdout: `FORMATTED\t<path>`, `FINDING\t<path>\t<line>\t<ID>\t<message>`,
  `ERROR\t<path>\t<message>`. Exit 0 unless the engine itself failed.
- Node `engine.js`: `runEngine({ manifest, files: [{ path, ranges }],
profile, rules, disabled }): { formatted: string[], findings: Finding[],
errors: {path, message}[] }`, `Finding = { file, line, rule, message }`.
  Env `JAVA_PLUGIN_ENGINE_CMD` replaces the java command (tests use a fake
  script that prints canned lines).
- `profile.js`: `resolveProfile({ repoRoot, config }): string | null` —
  `config.formatter.profile` (repo-relative) if set; else the first project
  file found by `git ls-files '*.xml'` containing
  `<profiles` and `kind="CodeFormatterProfile"`; else
  `.settings/org.eclipse.jdt.core.prefs`; else, only when `config` is
  non-null, the shipped `engine/default-formatter.xml`; else `null`.

- [ ] **Step 1: Write failing tests:**
  - `profile.test.js`: each branch of `resolveProfile`, including "no
    config, no project profile → null".
  - `engine.test.js` (fake engine): `runEngine` writes the request file in
    the format above and parses all three output kinds; a path with a space
    and a tab-free message round-trip.
  - `engine.test.js` (real engine, `skip` unless `readInstall()` succeeds):
    fixture `Messy.java` with ranges `4-4` → only line 4 changes (compare to
    `Messy.expected-range.java`); `*` → whole file matches
    `Messy.expected-full.java`; a CRLF copy keeps `\r\n` and gets the same
    result; `Broken.java` (unbalanced brace) → one `ERROR`, not formatted,
    while `Messy.java` in the same request is formatted.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement the Java side.** `Profiles.load(path)`: an Eclipse
      XML → map of `<setting id value>` from the first `CodeFormatterProfile`;
      `.prefs` → `key=value` properties; always overlay compiler
      source/compliance from `--source`. `Formatter.format(source, lines,
options)`: convert line ranges to `org.eclipse.jface.text.Region` offsets
      and call `ToolFactory.createCodeFormatter(options).format(K_COMPILATION_UNIT
| F_INCLUDE_COMMENTS, source, regions, 0, lineSeparator)` with the file's
      own separator; `null` edit → `ERROR` "could not be formatted (syntax
      error?)". Write back only when the content changed. `default-formatter.xml`
      is an Eclipse profile export reflecting the standard (4-space indent, no
      tabs, `@formatter:off/on` markers enabled, line width 120).
- [ ] **Step 4: Implement** `engine.js` and `profile.js`.
- [ ] **Step 5: Run** `node scripts/install-engine.js` then the tests →
      PASS.
- [ ] **Step 6: Commit** `feat(java): format changed line ranges with the
JDT engine`.

### Task 6: Source-rule framework and first rules

**Files:**

- Create: `.../engine/Rule.java`, `.../engine/Finding.java`,
  `.../engine/Suppressions.java`, `.../engine/RuleRegistry.java`,
  `.../engine/rules/*.java` (one class per rule ID),
  `plugins/java/scripts/hooks/__tests__/rules.test.js`,
  `plugins/java/scripts/hooks/__tests__/fixtures/rules/<ID>/{Bad,Good}.java`

**Interfaces:**

- `interface Rule { String id(); default int minJava() { return 0; }
default int minBoot() { return 0; } List<Finding> check(SourceFile file);
}` — `minBoot` is `major*100+minor` (`302` = Boot 3.2); `RuleRegistry`
  skips a rule whose `minJava` exceeds `--source` or whose `minBoot` exceeds
  `--boot` (`none` = no Spring Boot → Boot-specific rules skipped).
  with `SourceFile = (Path path, String source, CompilationUnit ast,
boolean isTest)`; AST from `ASTParser.newParser(AST.getJLSLatest())`,
  `K_COMPILATION_UNIT`, no bindings.
- `Suppressions.filter(SourceFile, List<Finding>) → List<Finding>` applies
  the `java-rules:allow` rule from Global Constraints.
- Fixture convention: a line ending in `// expect: <ID>` must produce exactly
  that finding on that line; `Good.java` must produce none. `rules.test.js`
  walks `fixtures/rules/*/`, runs the real engine with `--rules on` and
  ranges `-`, and asserts the set of `(line, ID)` equals the expectations.
  Skips without an installed engine.

- [ ] **Step 1: Write fixtures** (Bad + Good) for: J16 (wildcard import,
      static too), J1 (`@author`, `@version`), J2 (`///` and `/**` doc comments
      in one file), J3 (3+ consecutive `//` lines, `///` excluded), S2
      (`LoggerFactory.getLogger(`), S3 (`@Autowired` anywhere), S4
      (`@Value("${…}")` on a field or parameter), S57 (`RestTemplate`,
      `WebClient` types; `minBoot 302`, so a `--boot 2.7` fixture run reports
      nothing), B6 (`@formatter:off` without `on`), T2 (JUnit
      `org.junit.jupiter.api.Assertions` import; `@Test` method not matching
      `should[A-Z]\w*When[A-Z]\w*`, test files only), T7
      (`ReflectionTestUtils.setField`; `mock(<X>Dto.class)`), J0 (allow comment
      without reason), plus a suppression fixture where `// java-rules:allow S3
legacy bean wiring` removes the S3 finding.
- [ ] **Step 2: Run** `node --test scripts/hooks/__tests__/rules.test.js` →
      FAIL.
- [ ] **Step 3: Implement** `Rule`, `Finding`, `Suppressions`,
      `RuleRegistry` (all rules, filtered by `--disabled`), and the rules above;
      wire `--rules on` into `Main` (runs on every request line, independent of
      its ranges).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(java): add the source-rule engine and first
rules`.

### Task 7: Remaining source rules

**Files:** `.../engine/rules/*.java`, `fixtures/rules/<ID>/*` for each ID
below.

**Interfaces:** Consumes Task 6's `Rule`, fixtures and test runner
unchanged.

- [ ] **Step 1: Write fixtures** (gating: J13 `minJava 10`, J14 `minJava
15`, J2 `minJava 23` — added to Task 6's J2 — each with a fixture run at
      `--source 8` that reports nothing; S42 `minBoot 300`) for: J9 (member
      order: constants, fields,
      constructors, public methods, private methods, nested types — finding on
      the first out-of-order member), J13 (`var x = call()` → finding; `var x =
new T()` and literals → none), J14 (two or more string literals containing
      `\n` joined by `+` across lines), J20 (`Optional` as field type or
      parameter type), S6 (`public` class annotated `@Configuration`,
      `@RestController`, `@Controller`), S14 (`@Data` on a class named
      `*ReadDto`), S15 (`@Data`/`@EqualsAndHashCode`/`@ToString` on `@Entity`;
      `@Id`/`@Version`/`@Embedded audit` field without
      `@Setter(AccessLevel.NONE)` when the class has class-level `@Setter` or
      `@Data`), S21 (`expression = "java(` in `@Mapping`; `private` non-static
      method in a `@Mapper` class), S22 (`@Mapper` on an interface), S28/S30
      (mapping path segment starting with
      `get|create|update|delete|add|remove|fetch|list|find` → S28; `{id}`
      variable → S30), S42 (`.getMessage()` inside a call to
      `ProblemDetail.forStatusAndDetail` or `setDetail`), S46
      (`java.util.Date`, `LocalDateTime`, `ZonedDateTime` field in `@Entity`),
      S50 (`nativeQuery = true` with no comment on the preceding line).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the rules.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(java): add the remaining source rules`.

### Task 8: Null-annotation rules

**Files:** `.../engine/rules/NullMarked*.java` etc.,
`fixtures/rules/J20N/*` (multi-file fixture packages).

**Interfaces:**

- Rule ID `J20` for all of these; the `javax`/`jakarta` checks accept
  Boot 2's `javax.*` packages as the project's own namespace where Boot < 3.
  `Main` gains `--nullness
jspecify|spring|auto` (Node passes the config value; `auto` = whichever
  library the files in the request import, JSpecify if both).
- Package-level checks need the package directory: the rule reads
  `package-info.java` next to the file from disk.

- [ ] **Step 1: Write fixtures:** package without `package-info.java` →
      finding on line 1 of each in-scope file ("package com.x has no
      package-info.java with @NullMarked"); `package-info` with `@NullMarked`
      (or `@NonNullApi` + `@NonNullFields` under `spring`) → none; a file
      importing `org.springframework.lang.Nullable` in a `jspecify` run →
      finding; `lombok.NonNull`, `jakarta.validation.constraints.NotNull` on a
      parameter or return without a JSpecify/Spring nullness annotation,
      `javax.annotation.Nullable`, `jakarta.annotation.Nullable` → finding;
      `return null;` in a method whose return type lacks `@Nullable` → finding;
      JSpecify `@Nullable` written as a declaration annotation before a
      qualified or array type (`@Nullable java.util.List x`,
      `@Nullable String[] a`) → finding.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(java): check JSpecify and Spring nullness
annotations`.

### Task 9: Build-file checks

**Files:** Create `plugins/java/scripts/hooks/build-rules.js`,
`__tests__/build-rules.test.js`.

**Interfaces:** `checkBuildFile(absPath: string, text: string): Finding[]`.

- [ ] **Step 1: Write failing tests:** `pom.xml` with a `<dependency>`
      whose `<version>` is a literal → `B2` on that line; `${zjsonpatch.version}`
      → none; dependencies inside `<dependencyManagement>` importing a BOM →
      none; no `<java.version>` and no `maven.compiler.release` → `B4` on line 1;
      Gradle: `implementation("g:a:1.2.3")` → `B2`; `libs.foo` → none; no
      `toolchain`/`sourceCompatibility` → `B4`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with line-oriented regexes (XML and Gradle are
      only scanned, never parsed).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(java): check dependency versions and Java
version in build files`.

### Task 10: Stop loop

**Files:** Create `plugins/java/scripts/hooks/check-and-loop.js`,
`__tests__/check-and-loop.test.js`; modify `hooks.json` (Stop,
SubagentStop, `timeout: 180`).

**Interfaces:**

- Consumes: Tasks 1–9; ad-lfl-kit `loopStateDir`, `readTrackedFiles`,
  `trackSessionChanges`, `changedRangesByFile`, `scopesFor`,
  `partitionByScope`, `runFixLoop`.
- Produces: `check()` returning `{ failed, report }` with sections `##
Source rules`, `## Build files` (later tasks add `## NullAway` and `##
ArchUnit` through `registerSection(name, fn)` in the same module).
  `OWN_STATE_FILES = [TOUCHED_FILES, 'attempts.json']`.

Order per stop: track background writes → read tracked files → repo root
and config → **format** (`fix` callback of `runFixLoop`: in-scope `.java`
files, ranges from `changedRangesByFile` unless `scope: file`; without config
only when `resolveProfile` returns a project profile) → **check** (engine
rules on in-scope files, build-file checks, extra sections) → partition each
section's findings with `scopesFor` → in-scope findings fail the loop;
out-of-scope ones are listed under "Already present (not blocking)".

- [ ] **Step 1: Write failing tests** (fake engine via
      `JAVA_PLUGIN_ENGINE_CMD`, scratch git repos):
  - no config and no profile → no engine call, no output;
  - no config, project profile present → engine called with ranges, never
    with `--rules on`, no block;
  - config + a finding on a changed line → `decision: "block"`, report
    contains the ID and file:line;
  - finding on an untouched line → no block, listed as already present;
  - `checks.enabled: false` → no `--rules on`;
  - `disabledRules: ["S3"]` → `--disabled S3` passed;
  - engine `ERROR` for a file → stderr warning, no block;
  - manifest missing / `findJava` null → one warning, no block, state
    cleaned;
  - file outside any git repo → finding blocks; with `scope:
'changed-lines'` it is passed with ranges `-` (not formatted);
  - SubagentStop checks only the subagent's files (as in python's tests).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** following
      `plugins/python/scripts/hooks/check-and-loop.js`; guidance text: fix the
      findings, or add `// java-rules:allow <ID> <reason>` when the rule
      genuinely doesn't apply; the cap notice as python's.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(java): format and check session files at
Stop`.

## Phase 3 — NullAway

### Task 11: Dependency classpath resolution

**Files:** Create `plugins/java/scripts/hooks/classpath.js`,
`plugins/java/scripts/hooks/print-classpath.gradle`,
`__tests__/classpath.test.js`.

**Interfaces:**

- `moduleRootOf(absPath): string | null` — nearest dir with `pom.xml` or
  `build.gradle(.kts)`.
- `resolveClasspath({ moduleRoot, cacheDir }): { classpath: string[],
outputDirs: string[] } | null`. Every wrapper call sets `JAVA_HOME` to
  `buildJavaHome(moduleInfo(...).javaLevel)` (Task 3b) when found. Maven:
  `mvnw` (walk up as
  `plugins/editorconfig/scripts/hooks/backends.js` `jvmBin`) `-q -B
dependency:build-classpath -Dmdep.includeScope=test
-Dmdep.outputFile=<tmp>`; Gradle: `gradlew -q -I print-classpath.gradle
printTestCompileClasspath` (the init script registers that task, printing
  one path per line). `outputDirs` = existing `target/classes`,
  `target/test-classes`, `build/classes/java/main`,
  `build/classes/java/test`. Cache: `<cacheDir>/<sha256 of the module's
build files>.txt`; a cache hit spawns nothing. Timeout 120 s.

- [ ] **Step 1: Write failing tests** with fake `mvnw` / `gradlew` shell
      scripts that write a known classpath: Maven and Gradle parse; second call
      hits the cache (fake records invocations); editing `pom.xml` invalidates;
      wrapper exit 1 → `null` and a warning.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(java): resolve a module's dependency
classpath without changing the build`.

### Task 12: NullAway section

**Files:** Create `plugins/java/scripts/hooks/nullaway.js`,
`__tests__/nullaway.test.js`, `__tests__/fixtures/nullaway/*`; modify
`check-and-loop.js` (`registerSection('NullAway', …)`).

**Interfaces:**

- `buildJavacArgs({ manifest, classpath, outputDirs, processorJars, files,
mode, basePackage, outDir }): string[]` — exactly the invocation in Global
  Constraints; `mode: 'jspecify'` → `OnlyNullMarked=true`,
  `JSpecifyMode=true`; `mode: 'spring'` →
  `-XepOpt:NullAway:AnnotatedPackages=<basePackage>`.
- `detectMode(classpath, configured): 'jspecify'|'spring'|null` — `auto`:
  a `jspecify-*.jar` → jspecify; else `spring-core-*.jar` → spring; else
  `null` (skip with note "no JSpecify or Spring nullness annotations on the
  classpath").
- `processorJars(classpath, manifest)`: the project's `lombok-<v>.jar`
  first — or `manifest.jars.lombok` when `<v>` < `1.18.30`, with the note
  "project Lombok VERSION can't run on JDK 21; used the plugin's Lombok 1.18.48"
  — then
  `mapstruct-processor-*.jar` and `querydsl-apt-*.jar` if present.
- `parseNullAway(stderr): Finding[]` (rule `J20`).

- [ ] **Step 1: Write failing tests:** argument builder for both modes
      (flag list equality); `detectMode` for the three cases; processor
      ordering; parser on the spike output
      `na/src/com/acme/v2/Svc.java:6: error: [NullAway] passing @Nullable
parameter 'find(1)' where @NonNull is required` → `{ line: 6, rule: 'J20'
}`; non-NullAway compiler errors ignored. Real run (skip unless engine and
      JDK present): fixture package with JSpecify + Lombok `@Getter` reports
      exactly the `getNote().length()` dereference and the `return null`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** and register the section: per module, changed
      in-scope `.java` files only, `nullaway.enabled`, findings partitioned by
      `scopesFor` like the source rules.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(java): run NullAway on changed files at
Stop`.

## Phase 4 — ArchUnit

### Task 13: ArchUnit runner and standard rules

**Files:** Create `plugins/java/engine/archunit/src/dev/adk/java/archunit/Runner.java`,
`.../StandardRules.java`, `__tests__/archunit.test.js` (Java fixture
classes compiled by the test into a temp dir).

**Interfaces:**

- `java -cp <classes>:<archunit jars> dev.adk.java.archunit.Runner
--classes <dir:dir> --packages <p,p> --disabled <ID,ID> [--store <dir>]
[--create-store] [--extra <compiled rules dir>]`.
- Output: `FINDING\t<file-or-class>\t<line-or-0>\t<ID>\t<message>`, using
  ArchUnit's `(Foo.java:12)` source location when present; `ERROR\t-\t<msg>`.
- `StandardRules`: `public static Map<String, ArchRule> all(String[]
packages)` with IDs `S24` (service methods `save|update|delete|find.*`;
  public mapper methods `to[A-Z].*|update[A-Z].*`; use-case `*Service`
  classes with one public `handle`), `S7` (public methods of `..service..` /
  `..persistence..` interfaces mention no type named `*Dto` or `*Entity`),
  `D1` (`..domain..` depends on no `org.springframework..`,
  `jakarta.persistence..`, `javax.persistence..`, `com.fasterxml.jackson..`,
  `jakarta.validation..`, `javax.validation..`),
  `D5` (`rehydrate` called only from classes named `*Mapper*`), `S47`
  (`@Entity` classes have a field of type named `AuditEmbeddable`), `S40`
  (`@RestControllerAdvice` classes extend
  `org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler`),
  `S6` (`@Configuration` / `@RestController` classes not public; `*Impl`
  not public), `S25` (no package cycles in each feature slice). All
  annotations and types by name string.
- Store: `--store` wraps each rule in `FreezingArchRule` with a
  `TextFileBasedViolationStore` at that dir; the runner sets
  `freeze.store.default.allowStoreCreation=<--create-store>` and
  `freeze.refreeze=false` through `ArchConfiguration.get()` after
  `ArchConfiguration.get().reset()`, so a project `archunit.properties` is
  ignored.

- [ ] **Step 1: Write failing tests:** compile small fixture packages with
      `javac` and assert: a `ProjectService.saveProject` → S24; a service
      returning `ProjectEntity` → S7; `domain` class importing
      `org.springframework.stereotype.Component` (a stub annotation compiled
      into the fixture) → D1; with `--create-store` then a second run → no
      findings; after adding a new violation → only that one; a fixture
      `archunit.properties` in the classes dir does not change the result.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** `Runner` and `StandardRules`; Task 4's
      installer compiles them.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(java): add the ArchUnit runner and standard
rules`.

### Task 14: ArchUnit section

**Files:** Create `plugins/java/scripts/hooks/archunit.js`,
`__tests__/archunit-section.test.js`; modify `check-and-loop.js`.

**Interfaces:**

- `ensureCompiled({ moduleRoot, outputDirs, trackedSources, mode })` returns
  `'fresh'`, `'compiled'` or `'skipped'`; the wrapper runs with Task 3b's
  build JDK, as in Task 11. `auto`: compile only if a tracked source is newer
  than every output dir (`mvnw -q -B compile test-compile` or
  `gradlew -q classes testClasses`); `never`: stale → `skipped`.
- Project rules: `.claude/archunit/*.java` compiled with `javac -cp
<archunit jars>` into `<state dir>/archunit-extra`; each public static
  `ArchRule` field becomes a rule with ID `X:<FieldName>`.
- Registered section `ArchUnit`: runs once per module touched, findings not
  line-partitioned (package scope + freeze store); `archunit.disabledRules`
  passed through.

- [ ] **Step 1: Write failing tests** (fake runner + fake wrappers):
      disabled → no run; `compile: never` with stale classes → note, no block;
      `auto` with fresh classes → no compile; a FINDING → block with `S7` in the
      report; compile failure → warning, no block; `.claude/archunit/Extra.java`
      is compiled and `--extra` passed.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** and register.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(java): check architecture with ArchUnit at
Stop`.

## Phase 5 — Skills and documentation

### Task 15: Guidance skills

**Files:** Create `plugins/java/skills/<name>/SKILL.md` for the nine skills
in the spec's table; `plugins/java/scripts/__tests__/skills.test.js`.

**Interfaces:** each SKILL.md: frontmatter `name`, `description` (when to
use, ≤ 1,536 chars), `paths: "**/*.java, **/pom.xml, **/build.gradle*"`;
body starts with the shared preamble "Before applying this skill, read
`.claude/java-standards.json` at the repository root. If it doesn't exist,
or the file you're working on is outside its `include`/`exclude` scope,
follow the conventions of the surrounding code instead."; then the
standard's sections verbatim (from `plugins/java/standards/java-standards.md`).

- [ ] **Step 1: Write the failing test:** every ID J1–J24, B1–B10, S1–S58,
      D1–D11, T1–T7 appears as `**<ID>.` in exactly one skill; each skill has
      the frontmatter keys and the preamble; descriptions ≤ 1,536 chars.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Write the skills.**
- [ ] **Step 4: Run** → PASS; markdownlint over `plugins/java/**/*.md` → 0
      issues.
- [ ] **Step 5: Commit** `feat(java): add the standards skills`.

### Task 16: User-invoked skills and CLIs

**Files:** Create `plugins/java/skills/{setup,check,format}/SKILL.md`,
`plugins/java/scripts/check.js`, `plugins/java/scripts/format.js`,
`plugins/java/scripts/__tests__/cli.test.js`.

**Interfaces:**

- `node scripts/format.js <abs files...>` — whole-file format with
  `resolveProfile` (shipped default only when config exists; with no config
  and no project profile, exit 2 "no Eclipse formatter profile found").
- `node scripts/check.js <abs files...>` — source rules, build-file checks,
  NullAway, ArchUnit on the given files, **all** findings (no line
  scoping), exit 1 on findings.
- `node scripts/check.js --create-archunit-store` — runs the ArchUnit runner
  with `--create-store` into `.claude/archunit-store/`.
- `format` / `check` SKILL.md: `disable-model-invocation: true`,
  `argument-hint: '[file paths...] | [natural-language description of files
to include]'`, the resolution rules copied from
  `plugins/prettier/skills/format/SKILL.md` §1 (no args → whole project
  minus `exclude` and `.gitignore`; literal paths verified; natural
  language resolved via `git status`/`git diff`, ambiguous → list and ask),
  then run the CLI; `format` reports `git diff --stat`.
- `setup` SKILL.md: run `install-engine.js`; detect Maven/Gradle and the
  base package; ask whether the project is new (whole repo) or brownfield
  (ask for include/exclude and ArchUnit `packages`); show the
  `.claude/java-standards.json` it will write and ask before writing;
  offer to create the ArchUnit baseline (brownfield).

- [ ] **Step 1: Write failing tests** for both CLIs (fake engine): format
      passes `*` ranges; check passes `--rules on` and reports findings on
      untouched lines; `--create-archunit-store` passes `--create-store` and the
      store path.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the CLIs and write the three skills.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(java): add setup, check and format skills`.

### Task 17: Docs and end-to-end verification

**Files:** Create `plugins/java/README.md`; modify `README.md` (plugin
list, test commands, README links).

- [ ] **Step 1: Write `plugins/java/README.md`:** what it does, opt-in
      config reference (every key and default from Task 1), engine install and
      offline `--from-dir`, JDK 21 requirement, Java 8+ projects (level
      detection, `javaVersion`, the `jdk_homes` option and JDK discovery, the
      Lombok fallback, rules gated by level and Boot version), NullAway modes,
      ArchUnit freeze
      baseline and project rules (they execute project code at Stop — same
      trust as the build), coexistence with project ArchUnit tests, parallel
      Stop hooks with the editorconfig plugin.
- [ ] **Step 2: Run** `cd plugins/java && npm test && npm run
test:coverage` → all pass; `claude plugin validate plugins/java --strict`
      → passed; markdownlint on changed docs → 0 issues.
- [ ] **Step 3: End-to-end** in the scratchpad with a Spring Boot fixture
      (Maven wrapper; JSpecify, Lombok, MapStruct), session started with
      `--plugin-dir plugins/java`: each Verification bullet of the spec, in
      order, recording the observed output.
- [ ] **Step 4: Commit** `docs(java): document the java plugin`.
