---
name: java-build-standards
description: 'Use when editing pom.xml, build.gradle or lombok.config in a project that follows the java-standards opt-in. Covers the baseline stack (Java 25, Spring Boot 4, Jackson 3, Hibernate 7, Spring Modulith 2) and its On Boot 3 notes, choosing and parameterizing dependency versions, declaring the Java version, Eclipse JDT formatting, Spring Modulith and ArchUnit together over production classes only, the OpenAPI contract check, coverage gates that exclude generated code by pattern and configuring Lombok with MapStruct through one lombok.config (rules B1 to B10).'
paths: '**/*.java, **/pom.xml, **/build.gradle*'
---

<!-- Generated from standards/java-standards.md by scripts/build-skills.js. -->
<!-- markdownlint-disable MD013 -->

# Java build standards (Maven and Gradle)

Before applying this skill, read `.claude/java-standards.json` at the
repository root. If it doesn't exist, or the file you're working on is
outside its `include`/`exclude` scope, follow the conventions of the
surrounding code instead.

Break a rule only with a concrete reason, and write that reason down. At
Stop, the java plugin blocks on violations in lines you changed; mark a
justified exception with `// java-rules:allow <ID> <reason>`.

## Baseline

The standard targets one stack, and every example is written for it:

| Part            | Baseline                                                  |
| --------------- | --------------------------------------------------------- |
| Java            | 25 (see B4)                                               |
| Spring Boot     | 4.x, with Spring Framework 7 and Spring Security 7        |
| JSON            | Jackson 3 (`tools.jackson`), the default of Spring Boot 4 |
| Persistence     | Hibernate 7, through Spring Data JPA                      |
| Modules, outbox | Spring Modulith 2 (see D2 and D26)                        |

- **Examples follow the baseline only.** Where an older line differs, a note
  that starts with **On Boot 3** says what changes, and nothing else in the
  standard depends on it. Spring Boot 3.5's open-source support ended in June
  2026, so a new project starts on 4.x.
- **Jackson 3 keeps one old package.** Its annotations stay in
  `com.fasterxml.jackson.annotation`, while everything else moved to
  `tools.jackson`, which is why domain purity forbids both (see D15).
- **Raise the baseline deliberately.** When it moves, every example moves with
  it in one change, so the standard never mixes two generations again.

## Build (Maven and Gradle)

**B1. Choose versions deliberately.** Before adding a library, check which
version fits the project. Prefer the version managed by the framework BOM.

**B2. Parameterized versions.** A version outside the BOM is always a property
named `<artifactId>.version`, and the dependency refers to that property. In
Gradle, declare it in the version catalog under the artifact ID.

```xml
<properties>
    <zjsonpatch.version>0.6.4</zjsonpatch.version>
</properties>

<dependency>
    <groupId>io.github.vishwakarma</groupId>
    <artifactId>zjsonpatch</artifactId>
    <version>${zjsonpatch.version}</version>
</dependency>
```

**B3. Enforce at build time.** Whatever can be enforced at build time is
enforced there for reproducibility: OpenAPI generation, tests, formatting,
architecture.

**B4. Declare the Java version.** Always state the required Java version in the
build file. With the Spring Boot parent, set `java.version`. Add an enforcer
rule so the wrong JDK fails fast.

```xml
<properties>
    <java.version>25</java.version>
</properties>
```

**B5. Automated formatting.**

- **Preferred:** the Eclipse JDT formatter, enforced at build time through
  Spotless. This is the most reproducible option because it needs no IDE. To
  limit formatting to files changed in version control, use `ratchetFrom`, which
  works per file.
- **Fallback:** when CI can't enforce formatting, use the IntelliJ formatter
  with its rules versioned in the repository. Ideally, a pre-commit step runs it
  and touches only the lines changed in version control, which is an IntelliJ
  feature.

**B6. The formatter serves the reader.** Formatted code should read naturally.
When the output for a block is harder to read than the hand-written version,
turn the formatter off for that block and keep the block short. Enable the
markers first: "Turn formatter on/off with markers" in IntelliJ, and the off/on
tags in the Eclipse formatter profile that Spotless uses.

```java
// @formatter:off
private static final Map<ProjectStatus, Set<ProjectStatus>> TRANSITIONS = Map.of(
    DRAFT,    Set.of(ACTIVE, ARCHIVED),
    ACTIVE,   Set.of(ARCHIVED),
    ARCHIVED, Set.of());
// @formatter:on
```

**B7. Enforce the architecture.** Use both: Spring Modulith verifies the
boundaries between features (see D2), and ArchUnit enforces layering,
visibility, domain purity and the absence of package cycles inside each feature
(see D8). Both run as unit tests, and both import production classes only:
Modulith does so by default, and the ArchUnit suite declares it. The rules
govern the application, while tests legitimately reach into package-private
code (see T4).

```java
@AnalyzeClasses(packagesOf = Application.class, importOptions = ImportOption.DoNotIncludeTests.class)
class ArchitectureTest {
    // The @ArchTest rules of this standard.
}
```

**B8. Protect the API contract.** Generate the OpenAPI specification during the
build. Fail the build if it differs from the committed file, and check for
breaking changes.

**B9. A coverage gate that means something.** Measure branch coverage on the
code that T4 and T5 require tests for (see T1), and exclude only generated
code. JaCoCo skips code annotated
with an annotation whose simple name contains `Generated`, but only if the
annotation stays in the class file:

- **Lombok** qualifies: the `lombok.config` of B10 adds `@lombok.Generated`,
  which stays in the class file.
- **MapStruct, QueryDSL and OpenAPI Generator** don't: their `@Generated` has
  source retention, so JaCoCo never sees it. Exclude their output by pattern.

```xml
<plugin>
    <groupId>org.jacoco</groupId>
    <artifactId>jacoco-maven-plugin</artifactId>
    <configuration>
        <excludes>
            <!-- Generated code whose @Generated JaCoCo can't see. -->
            <exclude>**/*MapperImpl.class</exclude>
            <exclude>**/Q*Entity.class</exclude>
            <exclude>**/Q*Embeddable.class</exclude>
            <exclude>**/client/http/*/api/**</exclude>
            <exclude>**/client/http/*/model/**</exclude>
        </excludes>
    </configuration>
</plugin>
```

**B10. Lombok and MapStruct together.** The two are always used together, so
configure them as a pair on the compiler's annotation processor path, including
the binding artifact. Set Spring as the component model and constructor
injection as the strategy. Unmapped targets are compile errors. Keep `lombok`
out of the packaged application.

```xml
<plugin>
    <groupId>org.apache.maven.plugins</groupId>
    <artifactId>maven-compiler-plugin</artifactId>
    <configuration>
        <annotationProcessorPaths>
            <path>
                <groupId>org.mapstruct</groupId>
                <artifactId>mapstruct-processor</artifactId>
                <version>${mapstruct.version}</version>
            </path>
            <path>
                <groupId>org.projectlombok</groupId>
                <artifactId>lombok</artifactId>
                <version>${lombok.version}</version>
            </path>
            <path>
                <groupId>org.projectlombok</groupId>
                <artifactId>lombok-mapstruct-binding</artifactId>
                <version>${lombok-mapstruct-binding.version}</version>
            </path>
        </annotationProcessorPaths>
        <compilerArgs>
            <arg>-Amapstruct.defaultComponentModel=spring</arg>
            <arg>-Amapstruct.defaultInjectionStrategy=constructor</arg>
            <arg>-Amapstruct.unmappedTargetPolicy=ERROR</arg>
        </compilerArgs>
    </configuration>
</plugin>
```

One `lombok.config` at the root of the project configures Lombok for the
coverage gate (B9), NullAway (J20) and builders (J26):

```properties
config.stopBubbling = true
lombok.addLombokGeneratedAnnotation = true
lombok.addNullAnnotations = jspecify
lombok.builder.className = Builder
```
