---
name: java-language-standards
description: 'Use when writing or reviewing Java code in a project that follows the java-standards opt-in. Covers Javadoc and comments, naming, member, field and argument order, var, text blocks, records and sealed types, imports, visibility, overloads for optional arguments, null-safety with JSpecify and NullAway, Optional, reuse, utility classes and explained empty bodies (rules J1 to J25).'
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

**J3. Block syntax for long comments.** A comment spanning several lines always
uses `/* */`.

**J4. Comments serve the first-time reader.** Write every comment for someone,
human or AI agent, who is reading that code for the first time. Don't let the
author's own skill level or context decide what needs explaining, whether the
author is a person or an agent. Anything that could raise a question on first
read gets a comment, including intent, constraints and non-obvious trade-offs. A
comment that only restates the code adds nothing.

### Naming

**J5. Descriptive names.** Class and variable names are descriptive, even when
that makes them long. Domain names match the domain term exactly. Technical
names follow the type, as in `RestTemplate restTemplate`.

**J6. No redundant object in method names.** A method doesn't repeat the object
it belongs to, so the whole invocation reads cleanly:
`projectService.save(project)`, not `projectService.saveProject(project)`.

**J7. Names tell the truth.** A `void` method that throws is
`assertProjectExists`, not `doesProjectExist`. A `Duration` field isn't named
`...Minutes`.

**J8. One suffix per concept.** Pick one suffix and use it across the project,
for example `*Config` and never a mix of `*Conf` and `*Configuration`.

### Code organization

**J9. Fixed member order.** Classes always follow the same order: constants,
fields, constructors, public methods, private methods, nested types. Lombok
replaces hand-written accessors, `equals`, `hashCode` and `toString`, except on
JPA entities (see S15).

**J10. Meaningful field order.** Fields run from most to least important, top to
bottom, in the same order across the project: identifier, mandatory business
fields, optional business fields, then technical fields such as audit data and
version. Injected dependencies also follow one order: services, repositories,
mappers, then infrastructure clients.

**J11. Meaningful argument order.** Arguments run from most to least important,
left to right, and this order stays coherent across the project. In an update
method, the identifier comes first, then the body, then everything else.
Optional arguments always come last.

```java
Project update(Long id, Project project, @Nullable String reason);
```

**J12. Readable method bodies.** Declare local variables near their first use
and mark them `final` when they are immutable. Separate logical steps with a
blank line. A variable filled by a loop stays directly above that loop, with no
blank line between them. A log statement has a blank line on each side.

### Language features

**J13. `var` only when the type is obvious.** Use `var` only when the
right-hand side names the type, as with a constructor call or a literal:
`var usersById = new HashMap<Long, UserSummary>()`. Everywhere else, write the
type so it stays visible, in particular for method results.

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
public interface ProjectService {

    default Page<Project> findAll(Pageable pageable) {

        return findAll(pageable, null);
    }

    Page<Project> findAll(Pageable pageable, @Nullable ProjectFilter filter);

}
```

**J20. Null-safety as a compile-time guarantee.**

- Annotate nullability on every public signature.
- Use one library per project: the one your framework version uses (Spring's on
  Boot 3.x, JSpecify on Boot 4+), otherwise JSpecify.
- Make non-null the default at package level and annotate only the nullable
  exceptions.
- Enforce it at build time with a checker such as NullAway.
- Lombok's `@NonNull` and Bean Validation's `@NotNull` are runtime checks and
  don't replace this.
- Use `Optional` only for return values.

### Reuse

**J21. Don't repeat yourself.** If the same logic appears twice, extract it into
one method.

**J22. Don't reinvent the wheel.** If a library on the classpath already does
something (`StringUtils`, `NumberUtils`, and so on), use it rather than writing
a helper.

**J23. Non-instantiable utility classes.** A class with only static methods
hides its constructor, and that private constructor throws an exception.
Lombok's `@UtilityClass` does exactly this, so prefer it.

**J24. Consistent types across models.** POJOs of the same kind (DTOs, domain
objects, entities) use the same type and format for the same concept. All
identifiers share one format, all dates share one format, and so on.

**J25. Explain empty bodies.** An empty method or constructor body holds a
comment saying why it does nothing, for example a no-op hook, a framework
constructor or a deliberately ignored callback. A Javadoc above the method
doesn't count: the explanation goes inside the braces, where the reader sees
them empty.
