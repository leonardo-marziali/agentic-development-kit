---
name: java-language-standards
description: 'Use when writing or reviewing Java code in a project that follows the java-standards opt-in. Covers Javadoc and comments, naming, member, field and argument order, var, text blocks, records and sealed types, imports, visibility, overloads for optional arguments, null-safety with JSpecify and NullAway on every framework version, Optional, not repeating knowledge, utility classes, explained empty bodies and builders for long argument lists (rules J1 to J26).'
paths: '**/*.java, **/pom.xml, **/build.gradle*'
---

<!-- Generated from standards/java-standards.md by scripts/build-skills.js. -->
<!-- markdownlint-disable MD013 -->

# Java language standards

Before applying this skill, read `.claude/java-standards.json` at the
repository root. If it doesn't exist, or the file you're working on is
outside its `include`/`exclude` scope, follow the conventions of the
surrounding code instead.

Break a rule only with a concrete reason, and write that reason down. At
Stop, the java plugin blocks on violations in lines you changed; mark a
justified exception with `// java-rules:allow <ID> <reason>`.

## Java

### Documentation and comments

**J1. Complete Javadoc on public API.** Use every tag that applies to the
documented symbol (`@param`, `@return`, `@throws`, `{@link}`). Skip `@author`
and `@version`, which Git already records. Trivial and private members need no
Javadoc. Enforce with `-Xdoclint`.

**J2. One Javadoc syntax per project.** On Java 23 and later, write
documentation comments in Markdown, with `///` on every line (JEP 467). Javadoc
renders them as CommonMark, links use reference syntax such as
`[java.util.List]`, and block tags such as `@param` work as before. On older
Java versions, use HTML for richer formatting. Don't mix the two styles in one
project.

**J3. Block syntax for long comments.** A comment that isn't documentation and
spans several lines always uses `/* */`. Documentation comments follow J2.

**J4. Comments serve the first-time reader.** Write every comment for someone,
human or AI agent, who is reading that code for the first time. Don't let the
author's own skill level or context decide what needs explaining, whether the
author is a person or an agent. Anything that could raise a question on first
read gets a comment, including intent, constraints and non-obvious trade-offs. A
comment that only restates the code adds nothing.

### Naming

**J5. Descriptive names.** Class and variable names are descriptive, even when
that makes them long. Domain names match the domain term exactly. Technical
names follow the type, as in `RestClient restClient`.

**J6. No redundant object in method names.** A method doesn't repeat the object
it belongs to, so the whole invocation reads cleanly:
`projectRepository.save(project)`, not `projectRepository.saveProject(project)`.

**J7. Names tell the truth.** A `void` method that throws is
`assertProjectExists`, not `doesProjectExist`. A `Duration` field isn't named
`...Minutes`.

**J8. One suffix per concept.** Pick one suffix and use it across the project,
for example `*Config` and never a mix of `*Conf` and `*Configuration`. Port
implementations follow D6.

### Code organization

**J9. Fixed member order.** Classes always follow the same order: constants,
fields, constructors, public methods, protected and package-private methods,
private methods, nested types. Lombok replaces hand-written accessors, `equals`,
`hashCode` and `toString`. On JPA entities it generates only accessors and
constructors (see S15).

**J10. Meaningful field order.** Fields run from most to least important, top to
bottom, in the same order across the project:

1. the identifier;
2. mandatory business fields;
3. nullable business fields;
4. technical fields, always as tenant, version, then audit data.

Injected dependencies also follow one order: services, repositories, mappers,
then infrastructure clients.

**J11. The same order for arguments.** Arguments and record components follow
the order of J10, so a record reads like the class it mirrors, and a method's
parameters like the fields they fill: the identifier, the mandatory business
values (in a method that changes something, the new values), the nullable ones,
then the technical ones, such as an expected version. A nullable argument keeps
that place. Only an argument the caller can leave out entirely, through an
overload (see J19), moves to the end.

```java
void reschedule(BookingId id, DateRange period, @Nullable String reason);

record UpdateProjectDetailsCommand(ProjectId projectId, String name, @Nullable String description,
    long expectedVersion) {}
```

**J12. Readable method bodies.** Declare local variables near their first use
and mark them `final` when they are immutable. Separate logical steps with a
blank line. A variable filled by a loop stays directly above that loop, with no
blank line between them. A log statement has a blank line on each side.

- **Bodies open with a blank line.** A class, record or interface body starts
  and ends with a blank line, so its members stand apart from the declaration.
  A method or constructor body starts with one, but doesn't end with one.
- **An empty body, or one that holds only a comment, has none** (see J25).

Set the formatter's blank-line options to match, so the build keeps the layout
(see B5).

### Language features

**J13. `var` only when the type is obvious.** Use `var` only when the right-hand
side names the type, as with a constructor call or a literal:
`var projectsById = new HashMap<ProjectId, ProjectSummary>()`. Everywhere else,
write the type so it stays visible, in particular for method results.

**J14. Text blocks.** Multi-line text always uses a text block.

**J15. Modern constructs.** Use `sealed` for closed hierarchies and pattern
matching instead of casts. Use records for projections and small internal value
carriers (see S14 for DTOs).

**J16. No wildcard imports.** Enforced by the formatter (see
B5). The Eclipse JDT formatter doesn't expand
wildcards by itself, so add Spotless's wildcard-expansion step. In IntelliJ, set
the "use import with `*`" thresholds to a very high number.

**J17. Modules and package metadata.** Use `module-info.java` and
`package-info.java` when they add value, such as defining visibility rules or
removing repeated annotations.

**J18. Least privilege.** Every class gets the lowest visibility that works,
even when this shapes the package structure.

### API design

**J19. Overloads for optional arguments.** A public interface method with
optional arguments has one version with only the required arguments and another
with the additional ones. The interface does the routing, through a `default`
method.

```java
public interface ProjectQueries {

    default Page<ProjectReadModel> findAll(Pageable pageable) {

        return findAll(pageable, null);
    }

    Page<ProjectReadModel> findAll(Pageable pageable, @Nullable ProjectFilter filter);

}
```

**J20. Null-safety as a compile-time guarantee.**

- Annotate nullability on every public signature.
- Use JSpecify on every framework version. Spring's own `@Nullable` would put
  Spring into the domain (see D15), and NullAway, Lombok and Spring Framework 7
  all understand JSpecify.
- Make non-null the default at package level with `@NullMarked` in
  `package-info.java`, and annotate only the nullable exceptions.
- Enforce it at build time with NullAway on all main code, with
  `-XepOpt:NullAway:OnlyNullMarked=true`:
  - Lombok: set `lombok.addLombokGeneratedAnnotation = true`, which NullAway
    needs to recognize generated code, and
    `lombok.addNullAnnotations = jspecify`, so generated accessors and builders
    copy the field's nullability (see B10).
  - Generated code, such as MapStruct implementations and OpenAPI Generator
    output: set `-XepOpt:NullAway:TreatGeneratedAsUnannotated=true`.
  - JPA entities: suppress only the initialization check on their constructors
    (see S15).
- Lombok's `@NonNull` and Bean Validation's `@NotNull` are runtime checks and
  don't replace this.
- Use `Optional` only for return values.

### Reuse

**J21. Don't repeat knowledge.** Every rule, limit or decision has one home in
the code: if the same knowledge appears twice, extract it into one method,
constant or type. Code that only looks alike, but can change for different
reasons, stays apart: two commands with the same fields today are two commands
(see S11).

**J22. Don't reinvent the wheel.** If a library on the classpath already does
something (`StringUtils`, `NumberUtils`, and so on), use it rather than writing
a helper.

**J23. Non-instantiable utility classes.** A class with only static methods
hides its constructor, and that private constructor throws an exception.
Lombok's `@UtilityClass` does exactly this, so prefer it.

**J24. Consistent types across models.** POJOs of the same kind (DTOs, domain
objects, entities) use the same type and format for the same concept. All
identifiers share one format, all dates share one format, and so on. In the
core, identifiers of the module's own aggregates are typed value objects (see
D22). DTOs and entities carry the one underlying type they wrap, and a reference
to another module's aggregate carries that type everywhere (see D10).

**J25. Explain empty bodies.** An empty method or constructor body holds a
comment saying why it does nothing, for example a no-op hook, a framework
constructor or a deliberately ignored callback. A Javadoc above the method
doesn't count: the explanation goes inside the braces, where the reader sees
them empty.

**J26. Builders for long argument lists.** A method with more than seven
parameters takes one parameter object instead, built with a fluent builder, so
every value is named at the call site. Better still, also accept a `Consumer` of
that builder, the way the AWS SDK v2 configures its requests: the caller fills
in only what it needs inside a lambda, and the method builds the object. A
constructor with that many parameters needs a builder too (a step builder for
mandatory values, see D18), or, when they're injected dependencies, a split
class. An `@Override` keeps the signature it inherits, and a record's canonical
constructor mirrors its components.

```java
public interface ReportGenerator {

    Report generate(ReportRequest request);

    default Report generate(Consumer<ReportRequest.Builder> request) {

        final ReportRequest.Builder builder = ReportRequest.builder();
        request.accept(builder);
        return generate(builder.build());
    }

}

reportGenerator.generate(request -> request.projectId(projectId)
    .period(period)
    .format(ReportFormat.PDF));
```

`lombok.builder.className = Builder` in `lombok.config` (see B10) names every
Lombok builder `<Type>.Builder`. The `Consumer` overload suits Lombok builders,
whose values are mostly optional. A step builder can't be filled through a
`Consumer`, so commands use a `Function` instead (see S11).
