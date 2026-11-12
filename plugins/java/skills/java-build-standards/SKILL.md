---
name: java-build-standards
description: 'Use when editing pom.xml or build.gradle in a project that follows the java-standards opt-in. Covers choosing and parameterizing dependency versions, declaring the Java version, Eclipse JDT formatting, ArchUnit, the OpenAPI contract check, coverage gates and configuring Lombok with MapStruct (rules B1 to B10).'
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
    <java.version>21</java.version>
</properties>
```

**B5. Automated formatting.**

- **Preferred:** the Eclipse JDT formatter, enforced at build time through
  Spotless. This is the most reproducible option because it needs no IDE. To
  limit formatting to files changed in version control, use `ratchetFrom`, which
  works per file.
- **Fallback:** when CI can't enforce formatting, use the IntelliJ formatter
  with
  its rules versioned in the repository. Ideally, a pre-commit step runs it and
  touches only the lines changed in version control, which is an IntelliJ
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

**B7. Enforce the architecture.** Use ArchUnit or Spring Modulith to enforce
layering, visibility, domain purity and the absence of package cycles.

**B8. Protect the API contract.** Generate the OpenAPI specification during the
build. Fail the build if it differs from the committed file, and check for
breaking changes.

**B9. A coverage gate that means something.** Measure branch coverage on
business logic, and exclude only generated code. Set
`lombok.addLombokGeneratedAnnotation=true` in `lombok.config`, and exclude
`*MapperImpl` classes.

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
