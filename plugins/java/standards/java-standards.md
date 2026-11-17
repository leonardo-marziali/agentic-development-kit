<!-- Verbatim copy of the author's standard. -->
<!-- markdownlint-disable MD013 -->

# Opinionated Standards for Cloud-Native Java Enterprise Development

These are my opinions on how domain-driven and event-driven Java services should
be built. They target new projects and are deliberately strict. Break a rule
only when you have a concrete reason, and write that reason down.

Two principles sit behind everything else:

- **If a rule can be enforced by the build, it must be.** A convention that only
  lives in a document will erode.
- **Code is read far more often than it is written.** Consistency and clarity
  win over brevity.

## Contents

- [1. Java](#1-java)
- [2. Build (Maven and Gradle)](#2-build-maven-and-gradle)
- [3. Spring Boot](#3-spring-boot)
- [4. Domain-Driven, Hexagonal and Event-Driven Design](#4-domain-driven-hexagonal-and-event-driven-design)
- [5. Testing](#5-testing)

## 1. Java

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
names follow the type, as in `RestClient restClient`.

**J6. No redundant object in method names.** A method doesn't repeat the object
it belongs to, so the whole invocation reads cleanly:
`projectRepository.save(project)`, not `projectRepository.saveProject(project)`.

**J7. Names tell the truth.** A `void` method that throws is
`assertProjectExists`, not `doesProjectExist`. A `Duration` field isn't named
`...Minutes`.

**J8. One suffix per concept.** Pick one suffix and use it across the project,
for example `*Config` and never a mix of `*Conf` and `*Configuration`.

### Code organization

**J9. Fixed member order.** Classes always follow the same order: constants,
fields, constructors, public methods, protected and package-private methods,
private methods, nested types. Lombok replaces hand-written accessors, `equals`,
`hashCode` and `toString`. On JPA entities it generates only accessors and
constructors (see [S15](#models)).

**J10. Meaningful field order.** Fields run from most to least important, top to
bottom, in the same order across the project: identifier, mandatory business
fields, optional business fields, then technical fields such as audit data and
version. Injected dependencies also follow one order: services, repositories,
mappers, then infrastructure clients.

**J11. Meaningful argument order.** Arguments run from most to least important,
left to right, and this order stays coherent across the project. In a method
that changes something, the identifier comes first, then the new values, then
everything else. Optional arguments always come last.

```java
void reschedule(BookingId id, DateRange period, @Nullable String reason);
```

**J12. Readable method bodies.** Declare local variables near their first use
and mark them `final` when they are immutable. Separate logical steps with a
blank line. A variable filled by a loop stays directly above that loop, with no
blank line between them. A log statement has a blank line on each side.

### Language features

**J13. `var` only when the type is obvious.** Use `var` only when the right-hand
side names the type, as with a constructor call or a literal:
`var projectsById = new HashMap<ProjectId, ProjectSummary>()`. Everywhere else,
write the type so it stays visible, in particular for method results.

**J14. Text blocks.** Multi-line text always uses a text block.

**J15. Modern constructs.** Use `sealed` for closed hierarchies and pattern
matching instead of casts. Use records for projections and small internal value
carriers (see [S14](#models) for DTOs).

**J16. No wildcard imports.** Enforced by the formatter (see
[B5](#2-build-maven-and-gradle)). The Eclipse JDT formatter doesn't expand
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

## 2. Build (Maven and Gradle)

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
(see D8). Both run as unit tests.

**B8. Protect the API contract.** Generate the OpenAPI specification during the
build. Fail the build if it differs from the committed file, and check for
breaking changes.

**B9. A coverage gate that means something.** Measure branch coverage on
business logic, and exclude only generated code. The `lombok.config` of B10
marks Lombok's output as generated, and the gate excludes `*MapperImpl` classes.

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

## 3. Spring Boot

### Foundations

**S1. Lombok everywhere it helps.** Use it wherever it removes boilerplate, with
the type-specific rules in [Models](#models).

**S2. Logging.** Declare loggers with Lombok's `@Slf4j`.

**S3. Constructor injection.** Inject through the constructor with
`@RequiredArgsConstructor`.

**S4. Typed configuration.** Bind configuration with `@ConfigurationProperties`
records, not `@Value` fields. `@Value` fields bypass constructor injection and
force reflection in tests.

**S5. Autoconfiguration first.** The core of Spring Boot is autoconfiguration,
so prefer configuring through properties. If a library reduces boilerplate for a
technology, use it. An AWS integration uses Spring Cloud AWS, not the raw SDK.
Dropping to the raw SDK is allowed only for a feature the library lacks, with a
comment saying which.

**S6. Minimum visibility for managed classes.**

- Configuration classes and controllers aren't public.
- Application services, query services and repositories expose a public
  interface, the port, with a package-private implementation (see S10 and D6).
  Adapters can then depend only on the port, never on the implementation.
  ArchUnit checks it:

```java
@ArchTest
static final ArchRule portImplementationsArePackagePrivate = classes().that()
    .areAnnotatedWith(Service.class)
    .or().haveSimpleNameEndingWith("Impl")
    .should().notBePublic();
```

- Internal collaborators are package-private classes with no interface.
  Interfaces exist only at package boundaries, with one exception: a controller
  interface, which exists only to keep the OpenAPI annotations and the mappings
  apart from the logic (see S35).
- Repositories follow the same pattern (see [S44](#persistence)).

### Layers and flow

**S7. Aggregates for writes, read models for reads.** The core has two kinds of
driving port (see D6), and each exposes its own model:

- **Writes** go through application services (see S10). Each takes its own
  command, such as `UpdateProjectDetailsCommand`, never a DTO or an aggregate
  built by the caller. They return nothing, or the identifier of what they
  created. Only the core and the repositories see aggregates.
- **Reads** go through a query service, such as `ProjectQueries`, which returns
  read models such as `ProjectReadModel` (see D14). Read models carry what the
  client displays, audit data included, and have no behavior.

DTOs stop at the controller and entities stop at the persistence adapter. Spring
Data's `Pageable` and `Page` are the one accepted exception on these interfaces
(see [Pagination](#pagination)). They never appear inside domain classes.

**S8. The standard flow.** A typical update works like this:

1. **Controller**: orchestrates.
   1. Maps the write DTO, the identifier and the expected version from
      `If-Match` (see S27) to the application service's command.
   2. Calls the application service, or several if needed (see S9).
   3. Reads the result through `ProjectQueries`, maps it to a read DTO and
      returns the new version as `ETag`.
2. **Application service**: in one transaction, loads the current aggregate, has
   it check the expected version (see D13), applies the changes through domain
   behavior (see D17), and hands the aggregate back to the repository. The
   domain, not the mapper, decides which fields an update may touch.
3. **Repository**: copies the aggregate onto the managed entity, which the
   commit flushes, and publishes the aggregate's events (see D24).

The identifier belongs to the aggregate from its creation (see D19). The version
lives on the aggregate root, read-only, because the write side checks it (see
D13). Audit data never enters the domain: the persistence layer fills it, and
only the read model carries it to the API (see S47). The version reaches the
client as the `ETag` and comes back as `If-Match`.

The read after the update costs one more query, and it is deliberate. Hibernate
increments `@Version` when it flushes, at commit, so an aggregate mapped back
inside the transaction would still carry the old version and produce a stale
`ETag`. Reading after the commit returns the version and the audit data the
database actually holds.

```java
// Controller
@Override
public ResponseEntity<ProjectReadDto> update(Long projectId, ProjectWriteDto projectWriteDto,
    String ifMatch) {

    final ProjectId id = new ProjectId(projectId);

    updateProjectDetails.execute(projectApiMapper.toUpdateDetailsCommand(id, projectWriteDto, ETags.toVersion(ifMatch)));

    final ProjectReadModel updatedProject = projectQueries.getById(id);
    final Map<Long, UserSummary> usersById = userQueries.findSummaries(Set.of(updatedProject.ownerId()));

    return ResponseEntity.ok()
                         .eTag(ETags.of(updatedProject.version()))
                         .body(projectApiMapper.toReadDto(updatedProject, usersById));
}

// Port, in application. The command and its step builder are shown in S11.
public interface UpdateProjectDetails {

    void execute(UpdateProjectDetailsCommand command);

}

// Application service, package-private
@Service
@RequiredArgsConstructor
class UpdateProjectDetailsService implements UpdateProjectDetails {

    private final ProjectRepository projectRepository;

    @Override
    @Transactional
    public void execute(UpdateProjectDetailsCommand command) {

        final Project project = projectRepository.getById(command.projectId());
        project.assertVersion(command.expectedVersion());

        project.rename(command.name());
        project.setDescription(command.description());

        projectRepository.update(project);
    }

}

// Repository implementation
@Override
public void update(Project project) {

    /*
     * The service loaded this entity in the same transaction, so the persistence
     * context returns it without a second query. If another transaction commits
     * between the version check and the flush, @Version fails the flush. The
     * entity is managed, so the commit flushes the change without a save call.
     */
    final ProjectEntity projectEntity = projectJpaRepository.findById(project.getId().value())
                                                            .orElseThrow(() -> new ProjectNotFoundException(project.getId()));

    projectEntityMapper.updateEntity(project, projectEntity);
    aggregateEvents.publishFrom(project);
}
```

`VersionMismatchException` (see D13) and Spring's
`ObjectOptimisticLockingFailureException` both map to `412 Precondition Failed`.
A missing `If-Match` on an update returns `428 Precondition Required` (RFC
6585). Spring answers a missing required header with `400`, so the error handler
overrides that case (see S40). `ETags` in `shared.web` converts between a
version and a strong `ETag` value.

**S9. Limits of controller orchestration.** A controller may call several
services in sequence, but it makes no business decisions. Each service call runs
in its own transaction, so a flow that must be atomic or has real business steps
belongs in one application service (see S10).

### Services

**S10. One application service per use case.** Every action the system offers is
its own application service, following Hombergs' narrow services (_Get Your
Hands Dirty on Clean Architecture_, ch. 1 and 4) and Martin's Interactor (_Clean
Architecture_, ch. 22). The number of steps doesn't matter: renaming a project
is one step, preparing an order is many. Each action is three types side by side
in `application`:

| Type           | Name                   | Example                 | Visibility      |
| -------------- | ---------------------- | ----------------------- | --------------- |
| Port           | The action, verb first | `ArchiveProject`        | Public          |
| Command        | `<Port>Command`        | `ArchiveProjectCommand` | Public          |
| Implementation | `<Port>Service`        | `ArchiveProjectService` | Package-private |

- **Named after the intent.** The port is named in the ubiquitous language,
  after what the user means to do: `DraftProject`, `RenameProject`,
  `ArchiveProject`, `PrepareOrder`. The test is the domain, not the screen:
  attributes that carry no rule and no event of their own, such as a name and a
  description, may change together through one action, `UpdateProjectDetails`. A
  state with rules, such as a status, a budget or an owner, always gets its own
  action, because a generic `UpdateProject` hides which rule applies and can
  only emit a vague `ProjectUpdated`. In the REST API, the rule-free details are
  a `PUT` or `PATCH` on the resource, and each business action is its own
  operation on a noun (see S28), such as `PUT /projects/{projectId}/status`,
  which the controller maps to `ArchiveProject` or `ActivateProject`.
- **Verb first, as in the books.** Hombergs names ports `SendMoneyUseCase` and
  `RegisterAccountUseCase`; Buenosvinos and his co-authors name services
  `SignUpUserService`. The verb-first name reads as a sentence at the call site:
  `archiveProject.execute(command)`. All of a feature's actions still sort
  together, because they share the feature's package.
- **Grouped when crowded.** Past about ten classes, give each action its own
  subpackage named after it, such as `application.onboarding`. Never group by
  kind of class, such as `port` and `command`, which scatters one action over
  several packages.

**S11. One method, one command.** An application service exposes a single
method, always named `execute`, so every action is invoked the same way. The
name follows the Command pattern, as Buenosvinos and his co-authors use it (_DDD
in PHP_, ch. 11). In the book, one shared `execute` contract also lets one
decorator wrap every service. Here Spring's proxies do that job
(`@Transactional`), so no shared interface is needed (see S12). What remains is
uniformity: the port already names the action, and `execute` says nothing more.

`execute` never takes separate arguments. Its input is one command,
`<Port>Command`: a record next to the port that carries everything the action
needs. An action without input, such as a scheduled one, has `execute()`. It
returns nothing, or the identifier of what it created (see S7). Commands are
never shared between services: two actions that look alike today can evolve
apart (Hombergs, ch. 4).

- **Self-validating.** The compact constructor checks every value, so no adapter
  can hand the core an invalid command (see S34).
- **Built with a step builder.** Mandatory values come first, one step each, in
  the order of the record's components, so the compiler rejects a command with a
  missing value (see D18). Optional values share the final step, next to
  `build()`. Lombok's `@Builder` isn't used for commands: it fills a forgotten
  value with `null` or `0` without a word, which is the reason Hombergs gives
  for preferring constructors (ch. 4).
- **Nullability on every step.** Each step method states the nullability of its
  argument, like any other public signature (see J20). Jilt generates staged
  builders and treats JSpecify's `@Nullable` as optional. Use it only after
  checking that its generated step methods carry the annotations; otherwise
  write the builder by hand, as below.
- **A `Function`, not a `Consumer`.** The port may offer a `default` overload
  that takes a `Function` from the first step to the final step. The lambda must
  reach the final step, so the compiler still checks every mandatory value. The
  `Consumer` overload of J26 can't do this.
- **Checked by ArchUnit.** The port has one abstract `execute(<Port>Command)`,
  and the command has a static `builder()` that returns its first step.

```java
public record UpdateProjectDetailsCommand(ProjectId projectId,
    long expectedVersion,
    String name,
    @Nullable String description) {

    public UpdateProjectDetailsCommand {

        CommandCheck.of(UpdateProjectDetailsCommand.class)
                    .notNull("projectId", projectId)
                    .notNegative("expectedVersion", expectedVersion)
                    .notBlank("name", name)
                    .maxLength("name", name, Project.NAME_MAX_LENGTH)
                    .maxLength("description", description, Project.DESCRIPTION_MAX_LENGTH)
                    .throwIfInvalid();
    }

    public static ProjectIdStep builder() {

        return new Builder();
    }

    public interface ProjectIdStep {

        ExpectedVersionStep projectId(ProjectId projectId);

    }

    public interface ExpectedVersionStep {

        NameStep expectedVersion(long expectedVersion);

    }

    public interface NameStep {

        FinalStep name(String name);

    }

    // Optional values, in any order, then build().
    public interface FinalStep {

        FinalStep description(@Nullable String description);

        UpdateProjectDetailsCommand build();

    }

    private static final class Builder implements ProjectIdStep, ExpectedVersionStep, NameStep, FinalStep {

        private @Nullable ProjectId projectId;

        private long expectedVersion;

        private @Nullable String name;

        private @Nullable String description;

        @Override
        public ExpectedVersionStep projectId(ProjectId projectId) {

            this.projectId = projectId;
            return this;
        }

        @Override
        public NameStep expectedVersion(long expectedVersion) {

            this.expectedVersion = expectedVersion;
            return this;
        }

        @Override
        public FinalStep name(String name) {

            this.name = name;
            return this;
        }

        @Override
        public FinalStep description(@Nullable String description) {

            this.description = description;
            return this;
        }

        @Override
        public UpdateProjectDetailsCommand build() {

            // The steps guarantee these values; requireNonNull states it for NullAway.
            return new UpdateProjectDetailsCommand(Objects.requireNonNull(projectId),
                                                   expectedVersion,
                                                   Objects.requireNonNull(name),
                                                   description);
        }

    }

}

public interface UpdateProjectDetails {

    void execute(UpdateProjectDetailsCommand command);

    default void execute(
        Function<UpdateProjectDetailsCommand.ProjectIdStep, UpdateProjectDetailsCommand.FinalStep> command) {

        execute(command.apply(UpdateProjectDetailsCommand.builder()).build());
    }

}

// Both calls fail to compile if a mandatory value is missing.
updateProjectDetails.execute(UpdateProjectDetailsCommand.builder()
    .projectId(projectId)
    .expectedVersion(expectedVersion)
    .name(name)
    .build());

updateProjectDetails.execute(command -> command.projectId(projectId)
    .expectedVersion(expectedVersion)
    .name(name)
    .description(description));
```

MapStruct creates commands through their canonical constructor. It uses a
builder only when the builder type returned by `builder()` has a `build()`
method, and the first step has none. The compact constructor therefore validates
mapped commands too, and the mapper's unit test shows it (see T4).

**S12. Application services orchestrate; the domain decides.** An application
service loads aggregates through repositories, calls their behavior, and domain
services where a rule spans aggregates (see D20), then hands the aggregates back
to the repository.

- **No business decisions.** An `if` about a business rule belongs on the
  aggregate or in a domain service. An application service full of rules is a
  Transaction Script around an anemic model (Fowler, _PoEAA_).
- **Never return an aggregate.** A controller holding a `Project` could call
  `archive()` on it and bypass the service.
- **No base class.** The steps every service shares already have an owner, so
  there is nothing left to inherit: Spring runs the transaction
  (`@Transactional`), the repository's `getById` throws when the aggregate is
  missing (see S44) and publishes its events (see D24), the command validates
  its input (see S34), and the aggregate checks the expected version (see D13).
  A shared parent would couple every service to it for nothing; prefer
  composition (Gamma et al., _Design Patterns_, ch. 1).
- **`@Service` means application service.** Spring's `@Service` names both the
  DDD service and the "business service facade", and behaves exactly like
  `@Component`. Here it marks application services only. Domain services are
  plain Java (see D15 and D20), so they carry no Spring annotation at all.

```java
@ArchTest
static final ArchRule serviceStereotypeOnlyInApplication = classes().that()
    .areAnnotatedWith(Service.class)
    .should().resideInAPackage("..application..")
    .andShould().haveSimpleNameEndingWith("Service");
```

### Models

**S13. The model set.** A domain concept can have up to nine models, and exists
only in the forms it needs. For `Project`:

| Model                         | Layer       | Purpose                                  |
| ----------------------------- | ----------- | ---------------------------------------- |
| `ProjectReadDto`              | API         | Response body, when reads are needed     |
| `ProjectWriteDto`             | API         | Request body, when writes are needed     |
| `ProjectFilterDto`            | API         | Query params, when filtering is needed   |
| `DraftProjectCommand`         | Application | Input of `DraftProject` (see D19)        |
| `UpdateProjectDetailsCommand` | Application | Input of `UpdateProjectDetails` (see S8) |
| `ProjectReadModel`            | Application | Output of the query service (see D14)    |
| `ProjectFilter`               | Application | Input of the query service (see S52)     |
| `Project`                     | Domain      | Aggregate, always                        |
| `ProjectEntity`               | Persistence | Persistence model, when persisted        |

Every other action has its own command in the same way (see S11).

**S14. DTO style.** Read DTOs are immutable: use Lombok's `@Value` with
`@Builder`, because builders are more readable than constructors. Write and
filter DTOs use `@Data`. DTOs prefer composition over inheritance.

**S15. Entity style.** An entity is the record a Data Mapper writes (Fowler,
_PoEAA_), not the domain model. The aggregate owns the rules (see D17), so the
entity has no behavior, and an anemic entity is correct here. It stays
package-private, so nothing outside `persistence` can mistake it for the model
(see S17).

- **Two constructors.** A protected no-argument constructor for JPA, and one for
  what never changes after creation: the identifier, which comes from the
  aggregate (see D19), and the tenant. MapStruct creates entities through the
  second one. Mark it with `@Default` from `shared.mapping`, because MapStruct
  otherwise picks the no-argument constructor.
- **Setters only for what the mapper writes.** The identifier, the tenant, the
  version and the audit data have none (`@Setter(AccessLevel.NONE)`). They
  aren't MapStruct targets, so the mappers never list them (see S23).
- **Field access.** Mapping annotations go on fields, so JPA needs no accessors.
- **No generated `equals`, `hashCode` or `toString`.** Don't use `@Data`,
  `@EqualsAndHashCode` or `@ToString`: on lazy associations they trigger proxy
  initialization, and on bidirectional relations they recurse forever. If an
  entity needs `equals`, base it on the identifier and write it by hand.
- **Nullability.** Non-null columns are non-null fields. JPA fills them after
  the no-argument constructor, so `@SuppressWarnings("NullAway.Init")` on the
  constructors turns off only NullAway's initialization check (see J20).

```java
@Entity
@Table(name = "project")
@EntityListeners(AuditingEntityListener.class)
@Getter
@Setter
class ProjectEntity {

    @Id
    @Setter(AccessLevel.NONE)
    private Long id;

    @Setter(AccessLevel.NONE)
    private String tenantId;

    private String name;

    private long ownerId;

    @Enumerated(EnumType.STRING)
    private ProjectStatus status;

    private @Nullable String description;

    // A wrapper, so a null version tells Spring Data the entity is new (see S45).
    @Version
    @Setter(AccessLevel.NONE)
    private @Nullable Long version;

    /*
     * Initialized here so the listener always has an instance to fill: Hibernate
     * leaves an embedded field null when all of its columns are null (see S47).
     */
    @Embedded
    @Setter(AccessLevel.NONE)
    private AuditEmbeddable audit = new AuditEmbeddable();

    @SuppressWarnings("NullAway.Init")
    protected ProjectEntity() {
        // For JPA, which fills the fields after construction.
    }

    // MapStruct creates new entities through this constructor (see S23).
    @Default
    @SuppressWarnings("NullAway.Init")
    ProjectEntity(Long id, String tenantId) {

        this.id = id;
        this.tenantId = tenantId;
    }

}

// shared.mapping: MapStruct recognizes any annotation named @Default.
@Retention(RetentionPolicy.CLASS)
@Target(ElementType.CONSTRUCTOR)
public @interface Default {}
```

### Mapping

**S16. One mapper per layer boundary.** Each domain concept has one MapStruct
mapper per adapter it crosses into: `ProjectApiMapper` maps the DTOs to and from
the commands, read models and filter, and `ProjectEntityMapper` maps the entity
to and from the aggregate and to the read model. Mappers never access the
database. Any data they need is loaded beforehand and passed through `@Context`.

**S17. Mappers live with what they map.** Each mapper sits in the same package
as the types it maps and the only code that uses it, so the compiler enforces
the boundary instead of ArchUnit:

- `api` holds the controllers, the DTOs and `ProjectApiMapper`, all
  package-private.
- `persistence` holds `ProjectRepositoryImpl`, `ProjectQueriesImpl`,
  `ProjectJpaRepository`, `ProjectEntity`, `ProjectEntityMapper` and
  `ProjectPredicates`, all package-private. The public interfaces they implement
  live in the core: `ProjectRepository` in `domain` and `ProjectQueries` in
  `application` (see D6 and D14).
- DTOs and entities can't leak into `application` or `domain`, because nothing
  outside their package can see them. ArchUnit still checks what the compiler
  can't, such as domain purity (see D15).
- **Inject the mapper, never its implementation.** Code depends on the abstract
  `ProjectEntityMapper`, and only Spring knows the generated
  `ProjectEntityMapperImpl`. A reference to the implementation skips the type
  the contract is written on, and breaks when MapStruct regenerates it. The
  package-private mapper stops other packages, but not a class in the same
  package, so ArchUnit checks it:

```java
@ArchTest
static final ArchRule noOneUsesMapperImplementations = noClasses().that()
    .areNotAnnotatedWith(Generated.class)
    .should().dependOnClassesThat()
    .haveSimpleNameEndingWith("MapperImpl")
    .because("inject the abstract mapper; MapStruct owns the implementation");
```

`Generated` is `javax.annotation.processing.Generated`, which MapStruct puts on
every class it writes, so the implementations themselves are exempt. A
`MapperImpl` that extends another mapper's implementation would also be caught,
which is the point.

Converters used by more than one mapper are the exception, and they're public
(see S19): those of one feature, such as `ProjectIdMapper`, live in the
feature's `mapping` package, and those shared across features, such as
`DateMapper`, live in `shared.mapping`.

**S18. Arguments before `@Mapping`.** MapStruct matches a method's arguments to
target properties by name. A value that isn't on the source object is passed as
an argument named after the target property. Write `@Mapping` only when the
names can't be aligned.

```java
// Preferred: tenantId matches the target property by name
ProjectEntity mapToEntity(Project project, String tenantId);

// Avoid: the mapping only exists to fix a name that could have matched
@Mapping(target = "tenantId", source = "currentTenant")
ProjectEntity mapToEntity(Project project, String currentTenant);
```

**S19. Compose with `uses`.** A nested object is mapped by its own mapper, which
is injected through `uses` and never reimplemented. A value object that several
mappers convert, such as a typed identifier (see D22), has one converter that
they all reference the same way, so the conversion has one home (see J21):

- **One feature's value objects** have their converter in the feature's
  `mapping` package, such as `project.mapping.ProjectIdMapper`, used by
  `ProjectApiMapper` and `ProjectEntityMapper`.
- **Values shared across features**, such as dates, have theirs in
  `shared.mapping`, such as `DateMapper`.

Converters are hand-written Spring beans, so MapStruct injects them like any
other mapper. Their public methods follow the mapper vocabulary of S24.

```java
// project.mapping
@Component
public class ProjectIdMapper {

    public @Nullable ProjectId toProjectId(@Nullable Long id) {

        return id == null ? null : new ProjectId(id);
    }

    public @Nullable Long toLong(@Nullable ProjectId projectId) {

        return projectId == null ? null : projectId.value();
    }

}
```

**S20. Lookups through `@Context`.** A `@Context Map<K, V>` is the way to
resolve a reference during mapping: the caller loads the data in one batched
query (see S49) and the mapper only reads the map. MapStruct passes the context
down to any helper method that declares it. Pass an empty map rather than
`null`.

**S21. No Java expressions.** Avoid `expression = "java(...)"`, because the
compiler and the IDE's refactoring tools see it only as a string. Write a small
`protected` method instead, and MapStruct selects it by its source and target
types. Use `@Named` with `qualifiedByName` if two methods match the same types.
Don't make these helpers `private`: MapStruct silently ignores them and may fall
back to a built-in conversion, such as an enum's name.

**S22. Abstract classes with nullability proxies.** Mappers are abstract
classes, not interfaces, which allows two levels of visibility:

- Each `public final` method states the nullability contract and delegates to
  the generated method. Generated methods return `null` for a `null` source, and
  return a value for any other. The proxy states the case its callers have:
  non-null in and out by default, and `@Nullable` in and out only for a caller
  that really holds a nullable value. NullAway then checks both.
- Each `protected abstract` method is what MapStruct implements, so only the
  generated class and the proxies call it.

A proxy carries a MapStruct qualifier that removes it from automatic selection.
Without it, a nested or collection mapping finds both the proxy and the
generated method for the same types and fails with
`Ambiguous mapping methods found`. A method with several source arguments
returns `null` only if all of them are `null`, so give its arguments non-null
types, as `toEntity` does below.

```java
@Qualifier
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.CLASS)
public @interface IgnoreMethodForMapping {}
```

**S23. Ignore explicitly.** Every target property that a mapping method doesn't
set is declared with `@Mapping(target = "...", ignore = true)`. Because unmapped
targets are compile errors (see B10), a new field fails the build until someone
decides how each method handles it. Only writable properties are targets: a
property without a setter or constructor parameter, such as an entity's version
and audit data (see S15), is never listed.

These two mappers apply all of these rules:

```java
// persistence
@Mapper(uses = {ProjectIdMapper.class, DateMapper.class, AuditMapper.class})
abstract class ProjectEntityMapper {

    /*
     * Contract: the nullability is stated here, and these are the only methods
     * the repository and the query service call.
     */

    @IgnoreMethodForMapping
    public final Project toDomain(ProjectEntity projectEntity) {

        return mapToDomain(projectEntity);
    }

    @IgnoreMethodForMapping
    public final ProjectReadModel toReadModel(ProjectEntity projectEntity) {

        return mapToReadModel(projectEntity);
    }

    @IgnoreMethodForMapping
    public final ProjectEntity toEntity(Project project, String tenantId) {

        return mapToEntity(project, tenantId);
    }

    @IgnoreMethodForMapping
    public final void updateEntity(Project project, ProjectEntity projectEntity) {

        mapOntoEntity(project, projectEntity);
    }

    // MapStruct implements these. They are visible only to the generated class.

    protected abstract Project mapToDomain(ProjectEntity projectEntity);

    // The read model carries the audit data, which AuditMapper converts.
    @Mapping(target = "projectId", source = "id")
    protected abstract ProjectReadModel mapToReadModel(ProjectEntity projectEntity);

    /*
     * MapStruct creates the entity through its @Default constructor, which takes
     * the id and the tenantId (see S15). tenantId matches that parameter by name,
     * so it needs no @Mapping (see S18).
     */
    protected abstract ProjectEntity mapToEntity(Project project, String tenantId);

    // Only the setters are targets here: the id and the tenant never change.
    protected abstract void mapOntoEntity(Project project, @MappingTarget ProjectEntity projectEntity);

    /*
     * Reconstitutes a stored aggregate through the factory that D19 requires.
     * Audit data stays behind: it reaches the API through the read model only.
     */
    @ObjectFactory
    protected Project reconstitute(ProjectEntity projectEntity) {

        return Project.reconstitute(new ProjectId(projectEntity.getId()),
                                    projectEntity.getName(),
                                    projectEntity.getOwnerId(),
                                    projectEntity.getStatus(),
                                    projectEntity.getDescription(),
                                    Objects.requireNonNull(projectEntity.getVersion(), "a stored project has a version"));
    }

}

// api
@Mapper(uses = {ProjectIdMapper.class, DateMapper.class})
abstract class ProjectApiMapper {

    // projectId and expectedVersion match the command's components by name (see S18).
    @IgnoreMethodForMapping
    public final UpdateProjectDetailsCommand toUpdateDetailsCommand(ProjectId projectId,
        ProjectWriteDto projectWriteDto, long expectedVersion) {

        return mapToUpdateDetailsCommand(projectId, projectWriteDto, expectedVersion);
    }

    @IgnoreMethodForMapping
    public final ProjectReadDto toReadDto(ProjectReadModel project, Map<Long, UserSummary> usersById) {

        return mapToReadDto(project, usersById);
    }

    @IgnoreMethodForMapping
    public final ProjectWriteDto toWriteDto(ProjectReadModel project) {

        return mapToWriteDto(project);
    }

    protected abstract UpdateProjectDetailsCommand mapToUpdateDetailsCommand(ProjectId projectId,
        ProjectWriteDto projectWriteDto, long expectedVersion);

    protected abstract ProjectWriteDto mapToWriteDto(ProjectReadModel project);

    // Both helpers below are selected by their source and target types.
    @Mapping(target = "owner", source = "ownerId")
    @Mapping(target = "statusLabel", source = "status")
    protected abstract ProjectReadDto mapToReadDto(ProjectReadModel project,
        @Context Map<Long, UserSummary> usersById);

    // Lookup through @Context: no database access happens here.
    protected @Nullable OwnerDto toOwnerDto(long ownerId, @Context Map<Long, UserSummary> usersById) {

        final UserSummary userSummary = usersById.get(ownerId);

        return userSummary == null ? null : new OwnerDto(ownerId, userSummary.displayName());
    }

    // Replaces expression = "java(project.status().name().toLowerCase())".
    protected String toStatusLabel(ProjectStatus status) {

        return status.name().toLowerCase();
    }

}
```

### Method naming

**S24. Fixed method names, enforced by ArchUnit.** Repositories, query services
and mappers use a fixed vocabulary, as J6 and the examples above show.
Application services have their own, a single `execute` (see S11).

| Type          | Methods                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| Repository    | `save`, `update`, `delete`, `getById`, `getByIdForUpdate`, `findById`, `nextIdentity`, `nextIdentities` |
| Query service | `get*` and `find*`                                                                                      |
| Mapper        | `to*` and `update*`                                                                                     |

- **`get` never comes back empty.** A `get*` method returns the object or throws
  the aggregate's not-found exception (see S40). A `find*` method that looks for
  one object returns `Optional`, and one that looks for many returns a
  collection or a `Page`. A port offers both only when both are used. This
  follows Noback, whose read model repositories have a `getById` that throws
  when nothing is found (_Advanced Web Application Architecture_, ch. 3).
- **No generic base interfaces.** Enforce the vocabulary with ArchUnit rather
  than with generic base interfaces such as `CrudRepository<T, ID>` or
  `EntityMapper<E, D>`. Those interfaces pollute every signature with type
  parameters and force each implementation to carry the same set of methods,
  while an ArchUnit test constrains names and nothing else.
- **A new verb is added to the list deliberately.**

```java
@ArchTest
static final ArchRule repositoryMethodNames = methods().that()
    .areDeclaredInClassesThat().resideInAPackage("..domain..")
    .and().areDeclaredInClassesThat().haveSimpleNameEndingWith("Repository")
    .should().haveNameMatching(
        "save|update|delete|getById|getByIdForUpdate|findById|nextIdentity|nextIdentities");

@ArchTest
static final ArchRule queryServiceMethodNames = methods().that()
    .areDeclaredInClassesThat().resideInAPackage("..application..")
    .and().areDeclaredInClassesThat().haveSimpleNameEndingWith("Queries")
    .should().haveNameMatching("(get|find)[A-Z].*");

@ArchTest
static final ArchRule mapperMethodNames = methods().that()
    .areDeclaredInClassesThat().areAnnotatedWith(Mapper.class)
    .and().arePublic()
    .should().haveNameMatching("to[A-Z].*|update[A-Z].*");
```

### Package structure

**S25. Package by feature, then by layer.**

```text
com.company.app
├── Application.java
├── project/
│   ├── api/              ProjectReadOnlyController, ProjectReadWriteController
│   │                     (interfaces and implementations), ProjectReadDto,
│   │                     ProjectWriteDto, ProjectFilterDto, ProjectApiMapper
│   ├── client/
│   │   └── http/         Outbound HTTP adapters, such as PayPalHttpClient (see S57)
│   ├── application/      DraftProject, DraftProjectCommand, DraftProjectService,
│   │   │                 UpdateProjectDetails, UpdateProjectDetailsCommand,
│   │   │                 UpdateProjectDetailsService, ProjectQueries,
│   │   │                 ProjectReadModel, ProjectFilter
│   │   └── onboarding/   OnboardProject, OnboardProjectCommand,
│   │                     OnboardProjectService (see S10)
│   ├── config/           ProjectDomainConfig: beans for domain services (see D20)
│   ├── domain/           Project, ProjectId, value objects, state machines,
│   │                     domain events, domain exceptions, domain services,
│   │                     driven ports such as ProjectRepository
│   ├── mapping/          Converters shared by the feature's mappers, such as
│   │                     ProjectIdMapper (see S19)
│   ├── messaging/
│   │   ├── in/           Callbacks and consumers (driving), foreign integration
│   │   │                 events, inbox and its processor (see D27)
│   │   └── out/          Our integration events, externalization (driven,
│   │                     see D26)
│   ├── persistence/      ProjectRepositoryImpl, ProjectQueriesImpl,
│   │                     ProjectJpaRepository, ProjectEntity,
│   │                     ProjectEntityMapper, ProjectPredicates
│   └── scheduler/        Scheduled jobs
└── shared/
    ├── application/      CommandCheck, InvalidCommandException (see S34)
    ├── audit/            AuditInfo, AuditEmbeddable, RequestAuditorAware
    ├── config/           Cross-cutting configuration
    ├── domain/           AggregateRoot, DomainEvent, DomainException and its
    │                     categories (see S40)
    ├── error/            Adapter exceptions, global handler, error model
    ├── mapping/          Shared MapStruct converters, AuditMapper,
    │                     IgnoreMethodForMapping, Default
    ├── openapi/          Composed OpenAPI annotations
    ├── pagination/       PageableDto, PageDto, SortOrderDto, PageMapper
    ├── persistence/      AggregateEvents (see D24), ChangeHistory and
    │                     FieldHistory (see S48)
    └── web/              Interceptors, request context, PatchApplier, ETags
```

Controllers that only read and controllers that also write are separate classes
in the same package, so they can share the package-private DTOs and mapper (see
S17).

Each adapter package plays one role in the hexagon (see D5), with one deliberate
exception: `persistence` is a driven adapter, and it also implements the query
service, a driving port (see D14). `messaging` is the one technology on both
sides, so it is split: `messaging.in` receives and calls a driving port, and
`messaging.out` implements the publishing side. The two never depend on each
other (see D8). Everything in `application`, except the public ports and their
input and output records, is package-private (see S6).

### REST design

**S26. Richardson level 2.** REST APIs are built on resources, HTTP methods and
status codes, used as HTTP defines them.

**S27. Use the standard first.** If HTTP or an RFC already covers a feature, use
it instead of inventing a field, header or endpoint. Don't introduce custom `X-`
headers when a standard one exists.

| Need                      | Standard                                             |
| ------------------------- | ---------------------------------------------------- |
| Created resource address  | `201` with `Location` (RFC 9110)                     |
| Representation format     | `Accept` and `Content-Type` (RFC 9110)               |
| Lost-update protection    | `ETag`, `If-Match` and `412` (RFC 9110)              |
| Update without `If-Match` | `428` (RFC 6585)                                     |
| Conditional reads         | `ETag`, `If-None-Match` and `304` (RFC 9110)         |
| Response caching          | `Cache-Control` (RFC 9111)                           |
| Rate limiting             | `429` with `Retry-After` (RFC 6585, RFC 9110)        |
| Error body                | `ProblemDetail` (RFC 9457)                           |
| Partial update            | JSON Merge Patch (RFC 7396) or JSON Patch (RFC 6902) |

**S28. Nouns in endpoints.** Paths name resources and never contain verbs. The
HTTP method is the verb.

| Avoid                       | Prefer                    |
| --------------------------- | ------------------------- |
| `POST /getProjects`         | `GET /projects`           |
| `GET /deleteProject?id=42`  | `DELETE /projects/42`     |
| `POST /projects/42/archive` | `PUT /projects/42/status` |

**A state change is a `PUT` on the state.** A business action that moves a
resource to another state is a `PUT` on its state sub-resource, such as
`PUT /projects/{projectId}/status` with `{"status": "ARCHIVED"}`. The controller
maps the target state to the business action (see S10). Turning the action into
a noun, such as `POST /projects/42/archival`, is also valid REST, but it isn't
used here, so every state change has the same shape.

**S29. Plural collection names.** A path segment that names a collection is
plural, and a single resource is addressed by its identifier inside that
collection. The same plural name serves both, so every resource follows one
pattern.

| Avoid                  | Prefer                   |
| ---------------------- | ------------------------ |
| `GET /project/42`      | `GET /projects/42`       |
| `GET /project/42/task` | `GET /projects/42/tasks` |

**S30. Path variables named after their resource.** A path variable is named
after the resource it identifies, never just `id`, so nested paths stay
unambiguous and the name tells what the value refers to. The controller
parameter carries the same name, so `@PathVariable` needs no explicit value.
This relies on the `-parameters` compiler flag, which the Spring Boot parent
sets; a build without the parent must set it too.

| Avoid                           | Prefer                                 |
| ------------------------------- | -------------------------------------- |
| `/projects/{id}`                | `/projects/{projectId}`                |
| `/projects/{id}/tasks/{taskId}` | `/projects/{projectId}/tasks/{taskId}` |

**S31. Clear resource segmentation.** Resources have clear boundaries, and a
client shouldn't have to orchestrate many requests to compose what it needs. If
clients always need related data together, return it in one representation and
let the server fetch it efficiently (see S49).

**S32. Methods match what happens.** Each HTTP method matches the operation it
performs. A read is never a `POST`.

| Method   | Use for                    | Safe | Idempotent |
| -------- | -------------------------- | ---- | ---------- |
| `GET`    | Read                       | Yes  | Yes        |
| `POST`   | Create, or start a process | No   | No         |
| `PUT`    | Replace a whole resource   | No   | Yes        |
| `PATCH`  | Change part of a resource  | No   | No         |
| `DELETE` | Remove                     | No   | Yes        |

**S33. `PATCH` is JSON Merge Patch, or JSON Patch when it fits better.**

- **JSON Merge Patch by default.** Partial updates follow RFC 7396 with the
  media type `application/merge-patch+json`. The client sends only the fields it
  changes, and `null` removes a field. It is the simplest format for clients and
  covers most resources.
- **JSON Patch when the resource needs it.** Use RFC 6902 with
  `application/json-patch+json` when Merge Patch can't express the change:
  editing single array elements, or guarding a change with a `test` operation.
  Because the patch applies to a DTO, a field set to `null` and a removed field
  end up the same, so that difference never justifies JSON Patch. A resource can
  accept both on the same path, routed by `consumes`.
- **Patch the write DTO, not the entity.** Clients can then reach only writable
  fields.
- **Validate after patching.** Spring validates the request body, which here is
  the patch document, so the patched DTO has to be validated explicitly.
- **Protect against lost updates.** The read and the update run in separate
  transactions (see S9), so require `If-Match` and pass the version down as in
  S8 (see D13).
- **Use the maintained artifact for JSON Patch.** Use
  `io.github.vishwakarma:zjsonpatch`, which is the project's current home and
  supports both Jackson generations through the same Java package: `JsonPatch`
  for Jackson 2 and `Jackson3JsonPatch` for Jackson 3. Its Jackson dependency is
  optional, so declare the one you use. The old
  `com.flipkart.zjsonpatch:zjsonpatch` artifact stopped at 0.4.16 in 2023.

```java
// Controller
@Override
public ResponseEntity<ProjectReadDto> mergePatch(Long projectId, JsonNode mergePatch,
    String ifMatch) {

    final ProjectId id = new ProjectId(projectId);
    final ProjectWriteDto current = projectApiMapper.toWriteDto(projectQueries.getById(id));
    final ProjectWriteDto patched = patchApplier.applyMergePatch(mergePatch, current, ProjectWriteDto.class);

    updateProjectDetails.execute(projectApiMapper.toUpdateDetailsCommand(id, patched, ETags.toVersion(ifMatch)));

    final ProjectReadModel updatedProject = projectQueries.getById(id);
    final Map<Long, UserSummary> usersById = userQueries.findSummaries(Set.of(updatedProject.ownerId()));

    return ResponseEntity.ok()
                         .eTag(ETags.of(updatedProject.version()))
                         .body(projectApiMapper.toReadDto(updatedProject, usersById));
}

/*
 * shared.web. The Jackson 2 API is shown. On Jackson 3, use JsonMapper and
 * Jackson3JsonPatch, whose exceptions are unchecked.
 */
@Component
@RequiredArgsConstructor
public class PatchApplier {

    private final ObjectMapper objectMapper;

    private final Validator validator;

    public <T> T applyJsonPatch(JsonNode jsonPatch, T source, Class<T> type) {

        final JsonNode patched = JsonPatch.apply(jsonPatch, objectMapper.valueToTree(source));

        return readAndValidate(patched, type);
    }

    public <T> T applyMergePatch(JsonNode mergePatch, T source, Class<T> type) {

        final JsonNode patched = merge(objectMapper.valueToTree(source), mergePatch);

        return readAndValidate(patched, type);
    }

    // The merge algorithm defined in RFC 7396, section 2.
    private JsonNode merge(JsonNode target, JsonNode patch) {

        if (!patch.isObject()) {
            return patch;
        }

        final ObjectNode result = target instanceof ObjectNode objectNode ? objectNode : objectMapper.createObjectNode();

        patch.properties().forEach(entry -> {
            if (entry.getValue().isNull()) {
                result.remove(entry.getKey());
            } else {
                result.set(entry.getKey(), merge(result.path(entry.getKey()), entry.getValue()));
            }
        });

        return result;
    }

    private <T> T readAndValidate(JsonNode patched, Class<T> type) {

        final T result = read(patched, type);
        final Set<ConstraintViolation<T>> violations = validator.validate(result);

        if (!violations.isEmpty()) {
            throw new ConstraintViolationException(violations);
        }

        return result;
    }

    /*
     * Spring Boot ignores unknown JSON properties by default. Here that would
     * silently drop a patched field that doesn't exist on the DTO.
     */
    private <T> T read(JsonNode patched, Class<T> type) {

        try {
            return objectMapper.readerFor(type)
                               .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                               .treeToValue(patched, type);
        } catch (JsonProcessingException exception) {
            throw new InvalidPatchResultException(exception);
        }
    }

}
```

Failures map to these statuses, following RFC 5789:

| Failure                       | Exception                       | Status |
| ----------------------------- | ------------------------------- | ------ |
| Malformed JSON in the request | Handled by Spring               | `400`  |
| Invalid JSON Patch document   | `InvalidJsonPatchException`     | `400`  |
| Wrong media type              | Handled by Spring               | `415`  |
| Failed `test` operation       | `JsonPatchTestFailedException`  | `409`  |
| Patch can't be applied        | `JsonPatchApplicationException` | `422`  |
| Patched result has bad fields | `InvalidPatchResultException`   | `422`  |
| Patched result fails rules    | `ConstraintViolationException`  | `422`  |

### REST validation

**S34. Three layers of validation, each with its own job.** Every adapter can
call the core, so the core can't trust any of them to validate for it (Hombergs,
ch. 4).

- **REST DTOs** check what an HTTP request looks like: required fields, lengths,
  formats, ranges and patterns. A violation returns `400`, with every invalid
  field listed (see S42), and the annotations also document the contract (see
  S35). Use Jakarta Validation annotations, and create a custom annotation when
  the standard ones can't express the check. Use validation groups (`OnCreate`,
  `OnUpdate`) when rules differ by operation.
- **Commands** validate themselves in their compact constructors (see S11), so
  every adapter, REST, messaging or scheduler, passes through the same checks.
  `CommandCheck` collects every violation and throws one
  `InvalidCommandException`. Over REST it returns `400` like a DTO violation. In
  messaging it sends the message to the dead-letter table (see D27). In a
  scheduled job it's a bug, logged at `error` (see D29).
- **The domain** enforces business invariants, such as allowed state transitions
  or a uniqueness that depends on other data. A violation throws a coded domain
  exception (see S40 and S41), usually returned as `409` or `422`.

A limit that both a DTO and a command check is one constant, defined once (see
J21): on the aggregate when it's a fact of the domain, such as
`Project.NAME_MAX_LENGTH`, and referenced from both, as in
`@Size(max = Project.NAME_MAX_LENGTH)`.

```java
// shared.application
public final class CommandCheck {

    private final Class<?> commandType;

    private final List<FieldViolation> violations = new ArrayList<>();

    private CommandCheck(Class<?> commandType) {

        this.commandType = commandType;
    }

    public static CommandCheck of(Class<?> commandType) {

        return new CommandCheck(commandType);
    }

    public CommandCheck notNull(String field, @Nullable Object value) {

        if (value == null) {
            violations.add(new FieldViolation(field, "must be provided"));
        }

        return this;
    }

    public CommandCheck notBlank(String field, @Nullable String value) {

        if (value == null || value.isBlank()) {
            violations.add(new FieldViolation(field, "must not be blank"));
        }

        return this;
    }

    // A null value passes: notNull or notBlank decide whether it's required.
    public CommandCheck maxLength(String field, @Nullable String value, int maxLength) {

        if (value != null && value.length() > maxLength) {
            violations.add(new FieldViolation(field, "must have at most %d characters".formatted(maxLength)));
        }

        return this;
    }

    public CommandCheck notNegative(String field, long value) {

        if (value < 0) {
            violations.add(new FieldViolation(field, "must not be negative"));
        }

        return this;
    }

    public void throwIfInvalid() {

        if (!violations.isEmpty()) {
            throw new InvalidCommandException(commandType.getSimpleName(), violations);
        }
    }

}

public record FieldViolation(String field, String message) {}
```

### OpenAPI

**S35. Document everything.** Every public API is documented with OpenAPI
annotations, and everything that can be documented is.

- Always set an operation ID, a short summary and a meaningful description.
- Annotations live on controller interfaces with package-level visibility, so
  implementations contain only logic.
- Object query parameters use `@ParameterObject` to expand them into individual
  parameters.
- Reuse composed annotations such as `@BadRequestResponse`.
- Document every status an operation can actually return.

**S36. Examples.** Provide examples for requests (parameters, headers, bodies)
and responses, using meaningful domain data that stays coherent across the whole
specification. Write them inside the read and write DTOs, not in the
controllers. Path parameters and headers have no DTO, so their examples are the
exception and stay on the controller interface.

**S37. Internal APIs stay out of the specification.** Internal endpoints, such
as event callbacks and HTTP RPCs, are marked `@Hidden`. They aren't part of the
public contract, so S26 to S32 don't bind them, and an RPC may use a verb.
`@Hidden` only removes an endpoint from the documentation. It is still
reachable, so it needs its own access control.

**Event callbacks answer `202` and judge nothing.** An internal callback that
delivers an event takes the raw body as a `String`, stores it in the inbox (see
D27) and returns `202 Accepted`, whatever the payload holds. `202` means only
that the event arrived. Every `4xx` and `5xx` belongs to the platform, such as
authentication, the gateway, or a database that can't store the event, so the
callback never returns one for the content. It doesn't deserialize the payload
into a DTO either, because a malformed body would make Spring answer `400`
before the callback runs. Parsing and validation happen when the inbox is
processed, and an invalid event goes to the dead-letter table (see D27).

### Pagination

**S38. `Pageable` and `Page` start at the service.** Spring Data's types live in
the service layer and below. Controllers use `PageableDto` and `PageDto`, and
`PageMapper` converts between the two.

**S39. DTOs mirror Spring Data.** `PageableDto` and `PageDto` use the same field
names and types as `Pageable` and `Page`, with OpenAPI annotations added. The
API contract then belongs to the project, because Spring Data doesn't guarantee
a stable JSON form for `Page`. The one difference is `sort`, since Spring's
`Sort` isn't a usable API type: a `SortOrderDto` mirrors `Sort.Order` with
`property` and `direction`. Binding `sort=createdAt,DESC` from a query string
needs a registered `Converter<String, SortOrderDto>`.

```java
@Data
@ParameterObject
public class PageableDto {

    @Parameter(description = "Zero-based page index", example = "0")
    @Min(0)
    private int pageNumber = 0;

    @Parameter(description = "Maximum items per page", example = "20")
    @Min(1)
    @Max(100)
    private int pageSize = 20;

    @Parameter(description = "Sort criteria", example = "createdAt,DESC")
    private List<@Valid SortOrderDto> sort = List.of();

}

@Value
@Builder
public class PageDto<T> {

    @Schema(description = "Items on this page")
    List<T> content;

    @Schema(description = "Zero-based page index", example = "0")
    int number;

    @Schema(description = "Requested page size", example = "20")
    int size;

    @Schema(description = "Items on this page", example = "20")
    int numberOfElements;

    @Schema(description = "Items across all pages", example = "137")
    long totalElements;

    @Schema(description = "Total number of pages", example = "7")
    int totalPages;

    @Schema(description = "Whether this is the first page", example = "true")
    boolean first;

    @Schema(description = "Whether this is the last page", example = "false")
    boolean last;

    @Schema(description = "Whether this page has no items", example = "false")
    boolean empty;

    @Schema(description = "Sort criteria applied to this page")
    List<SortOrderDto> sort;

}

// Controller: one batched lookup for the owners on this page (see S49)
final Page<ProjectReadModel> projects = projectQueries.findAll(pageMapper.toPageable(pageableDto));
final Set<Long> ownerIds = projects.map(ProjectReadModel::ownerId).toSet();
final Map<Long, UserSummary> usersById = userQueries.findSummaries(ownerIds);

return ResponseEntity.ok(pageMapper.toPageDto(projects.map(project -> projectApiMapper.toReadDto(project, usersById))));
```

`PageMapper` is hand-written, because MapStruct can't generate a mapping for a
generic type variable. Bound `pageSize` so a client can't request an entire
table.

### Error handling

**S40. One consistent error model.**

- All REST exceptions go through a single `@RestControllerAdvice` that extends
  `ResponseEntityExceptionHandler`, so Spring's own 4xx errors stay correct.
- **Domain exceptions know nothing about HTTP** (see D15). Each one extends a
  category in `shared.domain`, says what went wrong in domain terms and carries
  a code (see S41). The advice maps the category to a status, in one exhaustive
  `switch` over the sealed hierarchy:

| Category                         | Meaning                                        | Status |
| -------------------------------- | ---------------------------------------------- | ------ |
| `AggregateNotFoundException`     | The aggregate doesn't exist                    | `404`  |
| `InvalidValueException`          | A value object rejected its input (see D22)    | `400`  |
| `InvalidStateException`          | The current state forbids the action (see D21) | `409`  |
| `BusinessRuleViolationException` | A business rule rejects the action             | `422`  |
| `VersionMismatchException`       | The client's version is stale (see D13)        | `412`  |

- **Adapter exceptions own their status.** Exceptions of the adapters, such as
  `InvalidPatchResultException`, live in `shared.error` and follow the hierarchy
  base exception → client (4xx) or server (5xx) → specific exception.
- Every API returns the same error format, preferably `ProblemDetail` (RFC
  9457).
- Client errors log at `warn` without a stack trace. Server errors log at
  `error` with one.
- 5xx responses never expose internals such as bucket names, keys or parser
  messages.
- GraphQL needs its own exception resolver, because REST advice doesn't cover
  it.

```java
// shared.domain
public abstract sealed class DomainException extends RuntimeException
    permits AggregateNotFoundException, InvalidValueException, InvalidStateException,
    BusinessRuleViolationException, VersionMismatchException {

    private final String code;

    protected DomainException(String code, String message) {

        super(message);
        this.code = code;
    }

    public String getCode() {

        return code;
    }

}

// One of the four open categories. VersionMismatchException is final.
public abstract non-sealed class AggregateNotFoundException extends DomainException {

    protected AggregateNotFoundException(String code, String message) {

        super(code, message);
    }

}

// project.domain
public class ProjectNotFoundException extends AggregateNotFoundException {

    public ProjectNotFoundException(ProjectId projectId) {

        super("PROJECT_NOT_FOUND", "Project %d doesn't exist.".formatted(projectId.value()));
    }

}

// shared.error
@Slf4j
@RestControllerAdvice
class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    @ExceptionHandler
    ResponseEntity<ProblemDetail> handleDomainException(DomainException exception) {

        final HttpStatus status = switch (exception) {
            case AggregateNotFoundException _ -> HttpStatus.NOT_FOUND;
            case InvalidValueException _ -> HttpStatus.BAD_REQUEST;
            case InvalidStateException _ -> HttpStatus.CONFLICT;
            case BusinessRuleViolationException _ -> HttpStatus.UNPROCESSABLE_CONTENT;
            case VersionMismatchException _ -> HttpStatus.PRECONDITION_FAILED;
        };

        log.warn("{}: {}", exception.getCode(), exception.getMessage());

        final ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, exception.getMessage());
        problem.setProperty("code", exception.getCode());

        return ResponseEntity.status(status).body(problem);
    }

    // Commands validate themselves (see S34). Each invalid field gets its own entry (see S42).
    @ExceptionHandler
    ResponseEntity<ProblemDetail> handleInvalidCommand(InvalidCommandException exception) {

        log.warn("Invalid {}: {}", exception.getCommandName(), exception.getViolations());

        final ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,
            "Some fields are invalid. Fix them and send the request again.");
        problem.setProperty("errors", exception.getViolations());

        return ResponseEntity.badRequest().body(problem);
    }

    // A missing If-Match on an update is 428 (RFC 6585), not Spring's default 400.
    @Override
    protected @Nullable ResponseEntity<Object> handleServletRequestBindingException(
        ServletRequestBindingException exception, HttpHeaders headers, HttpStatusCode status,
        WebRequest request) {

        if (exception instanceof MissingRequestHeaderException missingHeader
            && HttpHeaders.IF_MATCH.equalsIgnoreCase(missingHeader.getHeaderName())) {

            final ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.PRECONDITION_REQUIRED,
                "This update needs an If-Match header with the ETag of your last read.");

            return handleExceptionInternal(exception, problem, headers, HttpStatus.PRECONDITION_REQUIRED, request);
        }

        return super.handleServletRequestBindingException(exception, headers, status, request);
    }

}
```

`HttpStatus.UNPROCESSABLE_CONTENT` is Spring Framework 7's name for `422`. On
Spring Framework 6, use `UNPROCESSABLE_ENTITY`.

**S41. Coded domain errors.** Alongside technical errors, document custom domain
errors with examples. Each has a stable, machine-readable code, such as
`PROJECT_ALREADY_ARCHIVED`, returned in the error body as `code`.

**S42. Useful messages, nothing technical.** Every error response, `4xx` and
`5xx` alike, carries a message the client can act on: what went wrong and, where
possible, how to fix it.

- Write the `detail` for the client. "Project 42 is archived and can't be
  renamed" helps. "Invalid state" doesn't.
- Never show anything technical: exception messages from libraries, class names,
  stack traces, SQL, constraint or column names, hostnames, file paths or bucket
  names. Never copy `exception.getMessage()` from a library exception into the
  response.
- Validation errors list each invalid field with its own message.
- A `5xx` response has a generic message plus the trace or correlation
  identifier, so support can find the full error in the logs.
- An error received from a remote system is translated into our own error model,
  never passed through to our client (see S57).

**S43. Bulk operations account for every entry.** A bulk operation either runs
in a single transaction, so it succeeds or fails as a whole, or reports each
entry. When it isn't one transaction:

- Each failed entry is processed independently, so one failure doesn't stop the
  others.
- Each failed entry is logged with its identifier and the reason it failed,
  following the levels in S40. Log identifiers, not whole payloads, so no
  personal data reaches the logs.
- The operation ends with one summary log line: processed, succeeded and failed.
- When the bulk operation is an API call, the response lists the outcome of each
  entry, with the same kind of useful message as S42.

This applies to scheduled jobs as well as to API calls (see S49 and D29).

### Persistence

**S44. Repositories hide the persistence technology.** A public
`ProjectRepository` interface in `domain`, a driven port (see D6), speaks only
in domain objects. A package-private `ProjectRepositoryImpl` implements it by
delegating to a package-private Spring Data interface (`ProjectJpaRepository`),
which never leaves the package. Spring Data doesn't replace this layer, because
it would expose entities.

- **`getById` throws, `findById` doesn't.** `getById` returns the aggregate or
  throws its not-found exception, such as `ProjectNotFoundException` (see S40),
  so an application service never checks for a missing aggregate itself.
  `findById` returns an `Optional`, for the caller that has a decision to make
  when the aggregate is missing. The port offers `findById` only when someone
  uses it (see S24).
- **`getByIdForUpdate` locks the root.** It loads the aggregate with
  `OPTIMISTIC_FORCE_INCREMENT`, for a change confined to an inner entity (see
  D13).

**S45. The repository allocates identifiers.** An aggregate owns its identifier
from construction (see D19), so the repository hands it out before the aggregate
exists, through `nextIdentity()`, which returns the typed identifier (see D22)
wrapped around the database value. The entity's `@Id` has no `@GeneratedValue`.
Use the best source for the database:

| Database   | Source of `nextIdentity()`                              |
| ---------- | ------------------------------------------------------- |
| PostgreSQL | A sequence with `INCREMENT BY 1`                        |
| Oracle     | A sequence with `INCREMENT BY 1`                        |
| MySQL      | An application-generated UUIDv7, stored as `BINARY(16)` |
| MongoDB    | An `ObjectId` created in the application                |

- **One query, written down.** Reading a sequence is a native query, so it
  carries the comment S50 requires. MySQL has no sequences, so a project on
  MySQL uses UUIDv7 for every identifier, to keep one format (see J24).
- **Blocks for bulk inserts.** `nextIdentities(count)` fetches a whole block in
  one round trip, for example with
  `select nextval('project_seq') from generate_series(1, :count)`.
- **One allocation scheme per sequence.** Never let Hibernate's pooled optimizer
  and `nextIdentity()` share a sequence: its `INCREMENT BY` must match the one
  mechanism that reads it.
- **Tell Spring Data what is new.** With an assigned identifier, Spring Data can
  no longer detect a new entity by a `null` identifier, so `save` would call
  `merge` and run an extra `SELECT`. Declare the version as a `Long` wrapper
  (see S15): a `null` version marks the entity as new.
- **Batching still works.** Unlike `IDENTITY`, assigned identifiers keep
  Hibernate's JDBC batching: set `hibernate.jdbc.batch_size`,
  `hibernate.order_inserts=true` and, on PostgreSQL,
  `reWriteBatchedInserts=true` on the JDBC URL.

```java
interface ProjectJpaRepository extends JpaRepository<ProjectEntity, Long> {

    // Native: JPQL can't read a sequence.
    @Query(value = "select nextval('project_seq')", nativeQuery = true)
    long nextIdentity();

}
```

**S46. UTC everywhere.** Dates are represented and stored in UTC. Use `Instant`
for moments in time, and keep `LocalDate` for true calendar dates.

```properties
spring.jackson.time-zone=UTC
spring.jpa.properties.hibernate.jdbc.time_zone=UTC
```

**S47. Automatic auditing.** Every persisted entity is audited by the framework,
never by hand.

- **One value object.** The four audit fields live in a single `@Embeddable`,
  `AuditEmbeddable`, that every entity embeds. It uses Spring Data's
  `@CreatedDate`, `@LastModifiedDate`, `@CreatedBy` and `@LastModifiedBy`. The
  last one is Spring's name for "updated by", so keep it.
- **Enabled once.** Turn auditing on with `@EnableJpaAuditing` in
  `shared.config`, and register `AuditingEntityListener` on every entity, or
  once for all of them in `orm.xml`. ArchUnit checks that every `@Entity` has an
  `AuditEmbeddable` field.
- **Persistence and read models only.** The audit fields have no setters (see
  S15) and never enter the domain (see D19). The entity mapper copies them into
  an `AuditInfo` record that the read model carries (see D14), and the API can
  expose them in the read DTO. A time that has business meaning, such as
  `archivedAt`, isn't audit data: it belongs to the aggregate.
- **The auditor comes from the request.** A `RequestAuditorAware` implements
  `AuditorAware<String>` and reads the auditor from the current request: the
  authenticated principal or a claim of its token, such as `sub`, or a header.
  The claim or header name is configuration (see S4).
- **Trust only what the platform sets.** Read a header only when the gateway
  sets it and strips any client-supplied value. Otherwise a client can choose
  its own auditor.
- **Work outside a request has an auditor too.** Scheduled jobs and message
  consumers have no request, so they use a configured system auditor that names
  the job or consumer, never `null`.
- **Bulk statements bypass it.** A `@Modifying` query doesn't trigger the
  listener (see S50), so it sets the audit columns itself.

```java
@Embeddable
@Getter
public class AuditEmbeddable {

    @CreatedDate
    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @CreatedBy
    @Column(nullable = false, updatable = false)
    private String createdBy;

    @LastModifiedDate
    @Column(nullable = false)
    private Instant lastModifiedAt;

    @LastModifiedBy
    @Column(nullable = false)
    private String lastModifiedBy;

    @SuppressWarnings("NullAway.Init")
    public AuditEmbeddable() {
        // The auditing listener fills the fields when the entity is first stored.
    }

}
```

`ProjectEntity` in S15 shows how an entity embeds it.

**S48. Field-level history with JaVers.** Automatic auditing records who changed
a resource and when, not what changed. When the history of individual fields
between versions is needed, use JaVers with its Spring Boot starter for the data
store.

- **Commit explicitly, in the repository adapter.** JaVers' Spring Data aspect
  (`@JaversSpringDataAuditable`) records only what passes through `save` and
  `delete`. An update in this standard changes a managed entity and never calls
  `save` (see S8), so that aspect would miss every update, and ArchUnit forbids
  it. The repository adapter calls `ChangeHistory` instead, in the caller's
  transaction, so the snapshot commits or rolls back with the change.
- **Opt in per entity, enforced by ArchUnit.** An entity with field history is
  annotated `@FieldHistory` from `shared.persistence`. ArchUnit then requires
  every `save`, `update` and `delete` of the repository adapter that uses it to
  call `ChangeHistory`.
- **Snapshot the business fields only.** Mark the version and the audit data
  `@DiffIgnore`. The listener fills the audit data at flush, after the snapshot,
  and both would add a change to every commit.
- **Bulk statements bypass it.** A `@Modifying` statement changes rows without
  loading entities (see S50), so an entity with field history is never changed
  that way.
- JaVers' `AuthorProvider` uses the same source as `RequestAuditorAware`, so the
  audit columns and the change history always name the same author.
- Turn off JaVers' own schema management
  (`javers.sqlSchemaManagementEnabled=false`) and create its tables through
  migrations, like every other schema change (see S51).
- Expose the history through the API only through DTOs, like any other resource.

```java
// shared.persistence
@Component
@RequiredArgsConstructor
public class ChangeHistory {

    private final Javers javers;

    private final AuthorProvider authorProvider;

    // Runs in the caller's transaction, so the snapshot shares its outcome.
    public void record(Object entity) {

        javers.commit(authorProvider.provide(), entity);
    }

    public void recordDeletion(Object entity) {

        javers.commitShallowDelete(authorProvider.provide(), entity);
    }

}

// ProjectRepositoryImpl, with ProjectEntity annotated @FieldHistory
@Override
public void update(Project project) {

    final ProjectEntity projectEntity = projectJpaRepository.findById(project.getId().value())
                                                            .orElseThrow(() -> new ProjectNotFoundException(project.getId()));

    projectEntityMapper.updateEntity(project, projectEntity);
    changeHistory.record(projectEntity);
    aggregateEvents.publishFrom(project);
}

// Architecture test
@ArchTest
static final ArchRule fieldHistoryIsRecorded = methods().that()
    .areDeclaredInClassesThat(repositoriesOfFieldHistoryEntities())
    .and().haveNameMatching("save|update|delete")
    .should(callChangeHistory());

@ArchTest
static final ArchRule noSpringDataAuditAspect = noClasses()
    .should().beAnnotatedWith(JaversSpringDataAuditable.class)
    .because("updates never call save, so the aspect would miss them (see S48)");

private static DescribedPredicate<JavaClass> repositoriesOfFieldHistoryEntities() {

    return DescribedPredicate.describe("repositories of @FieldHistory entities",
        javaClass -> javaClass.getSimpleName().endsWith("RepositoryImpl")
            && javaClass.getDirectDependenciesFromSelf().stream()
                        .anyMatch(dependency -> dependency.getTargetClass().isAnnotatedWith(FieldHistory.class)));
}

private static ArchCondition<JavaMethod> callChangeHistory() {

    return new ArchCondition<>("record the change through ChangeHistory") {

        @Override
        public void check(JavaMethod method, ConditionEvents events) {

            final boolean recorded = method.getMethodCallsFromSelf().stream()
                                           .anyMatch(call -> call.getTargetOwner().isEquivalentTo(ChangeHistory.class));

            if (!recorded) {
                events.add(SimpleConditionEvent.violated(method, method.getFullName() + " doesn't call ChangeHistory"));
            }
        }

    };
}
```

**S49. Database round trips are sacred.** Every trip to the database has to
justify itself.

- **No N+1 queries:** collect the identifiers, fetch them in one batched query,
  build a lookup map by ID, and pass it to the mapper through `@Context`.
- **Fetch only what you need:** use projections, and let a GraphQL selection set
  drive which fields and joins are loaded.
- **One query for page and count:** where the database allows it, as a MongoDB
  `$facet` aggregation does.
- **Limit before joining:** apply pagination first, so lookups only touch the
  rows on the requested page.
- **Skip pointless queries:** return early when a filter or ID set guarantees an
  empty result, and don't run an existence check just before a read that fails
  anyway.
- **Use indexes deliberately:** default filters should let a query hit at least
  one index.
- **Cache slow-changing data:** see [Caching](#caching).
- **Bound batch work:** scheduled jobs process a configured maximum per run.
- **Keep sessions short with JPA:** set `spring.jpa.open-in-view=false`.

**S50. The most efficient query wins.** Choose the most efficient way to carry
out a read or a change, in this order of preference:

1. **Spring Data repository methods**, including derived queries, when they can
   express the operation efficiently.
2. **JPQL through `@Query`**, when they can't. On other data stores, use the
   store's own equivalent.
3. **QueryDSL predicates** for dynamic filters (see S53).
4. **Native queries** only as a last resort, with a comment saying why JPQL
   wasn't enough.

For a bulk change, a `@Modifying` JPQL statement beats loading each entity to
change it. It bypasses the persistence context, so `@Version` checks, auditing
and the change history of S48 don't run, and the code has to account for that.

**S51. Versioned database changes, with the tool that fits the project.** Every
schema change is a migration: versioned, committed with the code that needs it,
and applied by a migration tool. Never edit a migration once it has run on a
shared database; correct it with a new one. Hibernate only checks the schema and
never changes it:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

No migration tool is the default. Choose one when the project starts, from the
project's context, and write down the choice and the reason (see the
introduction):

| Context                                                                                                        | Choose                                                                |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| One database vendor, and most changes are native SQL (vendor types, partial indexes, partitioning, procedures) | Flyway, with plain SQL migrations                                     |
| One codebase deployed on several database vendors                                                              | Liquibase, with YAML or XML changelogs that it translates per vendor  |
| Changes need preconditions, or contexts and labels to run per environment                                      | Liquibase, with formatted SQL changelogs if native SQL still prevails |
| MongoDB                                                                                                        | Mongock, or `liquibase-mongodb` if the project already uses Liquibase |

- **Native SQL weighs most.** A vendor-neutral changelog pays off only when the
  same change really runs on more than one vendor. On a single vendor, it hides
  the SQL that reviewers read and DBAs tune anyway, and every vendor feature
  ends up as a raw `sql` block inside it.
- **Check the edition and the license.** Both tools keep features in paid
  editions: Flyway's undo and dry run need Flyway Teams. Liquibase Community is
  licensed under the Functional Source License since 5.0, and each version
  reverts to Apache 2.0 two years after its release. Have the terms approved for
  the project, in particular when it ships software to customers.
- **Roll forward, whatever the tool.** Undo scripts and declared rollbacks are
  for development databases. In production, a rollback that drops a column also
  drops the data written since, so a mistake is fixed by a new migration. A
  change that old and new instances can't both survive during a rolling
  deployment, such as a rename, is split into expand and contract migrations:
  add, backfill, switch the code, then drop in a later release.
- **One tool per database.** Never let two tools manage the same schema.
  Changing tool mid-project is a migration of its own: baseline the existing
  schema in the new tool and retire the old history table.
- **Autoconfigured by Spring Boot** (see S5). On Boot 4, add
  `spring-boot-starter-flyway` or `spring-boot-starter-liquibase`. Flyway also
  needs its database module, such as `flyway-database-postgresql`.

**Migration names say what they do.** Reading the migration folder top to bottom
reads the schema's history, without opening a file. Every versioned migration is
named `<version>__<action>_<object>[_<detail>]`:

```text
db/migration/
├── V1_3_0_001__create_sequence_project_seq.sql
├── V1_3_0_002__create_table_project.sql
├── V1_4_0_001__add_column_project_archived_at.sql
├── V1_4_0_002__create_index_project_owner_id_status.sql
├── V1_4_0_003__add_column_project_display_name.sql
├── V1_4_0_004__backfill_project_display_name.sql
├── V1_5_0_001__drop_column_project_name.sql
└── R__view_project_summary.sql
```

- **The version is the release, plus a sequence**:
  `V<major>_<minor>_<patch>_<sequence>`, such as `V1_4_0_003`. The release is
  the one that first ships the migration, which is the project's version in the
  build without `-SNAPSHOT`. The sequence is a three-digit counter that restarts
  at `001` in every release. Flyway reads `V1_4_0_003` as version `1.4.0.3` and
  compares each part as a number, so `1.10.0` correctly follows `1.9.0`. The
  folder then shows which schema each release needs, and a migration can be
  traced to a release notes entry without Git.
- **A collision fails loudly.** Two branches that both add `V1_4_0_003` make
  Flyway refuse to start, because two migrations share one version. The pipeline
  runs the migrations, so this fails before the merge; rename the later one to
  the next free number. Keep `out-of-order` at `false`, so a migration with a
  version below the newest applied one is rejected, never applied out of
  sequence.
- **A hotfix is applied twice, harmlessly.** A fix on the `1.3.x` branch ships
  as `V1_3_1_001`. Environments already on `1.4.0` would reject it as out of
  order, so the main branch gets the same change again as the next migration of
  the current release, written to be idempotent (`IF NOT EXISTS`, or a guarded
  `UPDATE`). Production applies the first and finds nothing to do in the second;
  every other environment applies only the second.
- **Never above the project version.** The build fails when a migration's
  release is higher than the project's version, which catches a migration
  numbered for a release that isn't being built.
- **The action comes first, from a fixed vocabulary**, the same way application
  services do (see S10). A new verb is added to the list deliberately (see S24):

| Change          | Pattern                                | Example                                  |
| --------------- | -------------------------------------- | ---------------------------------------- |
| New table       | `create_table_<table>`                 | `create_table_project`                   |
| Removed table   | `drop_table_<table>`                   | `drop_table_project_legacy_tag`          |
| Renamed object  | `rename_<type>_<old>_to_<new>`         | `rename_column_project_title_to_name`    |
| New column      | `add_column_<table>_<column>`          | `add_column_project_archived_at`         |
| Removed column  | `drop_column_<table>_<column>`         | `drop_column_project_name`               |
| Changed column  | `alter_column_<table>_<column>_<what>` | `alter_column_project_name_set_not_null` |
| Index           | `create_index_<table>_<columns>`       | `create_index_project_owner_id_status`   |
| Constraint      | `add_constraint_<table>_<what>`        | `add_constraint_project_unique_name`     |
| Sequence        | `create_sequence_<sequence>`           | `create_sequence_project_seq` (see S45)  |
| Reference data  | `insert_<table>_<what>`                | `insert_currency_iso_4217_codes`         |
| Data correction | `update_<table>_<what>`                | `update_project_status_draft_to_active`  |
| Backfill        | `backfill_<table>_<column>`            | `backfill_project_display_name`          |
| Data removal    | `delete_<table>_<what>`                | `delete_project_orphaned_tags`           |

- **Database names, in snake_case.** Tables and columns appear as the database
  names them, `project_task` and never `ProjectTask`, in lower-case ASCII.
- **One change per file.** If the description needs an "and", split the file. A
  table is the exception: `create_table_*` also creates its primary key, its
  constraints and its indexes. Small files matter beyond naming: MySQL and
  Oracle commit each DDL statement on its own, so a failure leaves less behind.
- **Name the change, never the ticket.** `fix`, `changes`, `update_schema` and
  `PROJ-123` say nothing about the change, and the release already sits in the
  version. The ticket goes in a comment on the first line of the file.
- **Repeatable migrations name their object.** A view, function or procedure
  that is recreated whenever it changes (Flyway's `R__`, Liquibase's
  `runOnChange`) is named `R__<type>_<name>`, such as `R__view_project_summary`
  or `R__function_project_budget_remaining`, because the file describes the
  object and not one change to it.
- **Liquibase uses the same names.** Each file holds one changeset, whose `id`
  is the file name without its extension, such as
  `1_4_0_003__add_column_project_display_name`. The `author` is the team,
  because Git already records the person (see J1). Liquibase sorts `includeAll`
  alphabetically, which puts `1_10_0` before `1_9_0`, so each release has its
  own folder, loaded with `includeAll`, and the master changelog includes the
  release folders explicitly, in release order. Set `logicalFilePath`, so moving
  a file doesn't run its changeset again.

The build enforces the names. With Flyway, turn on
`spring.flyway.validate-migration-naming=true`, so Flyway fails on a file it
would otherwise skip silently. Check the convention itself with a test, shown
here for Flyway. For Liquibase, drop the `V` prefix from the pattern and use
`Files.walk` to reach the release folders:

```java
class MigrationNamingTest {

    private static final Pattern VERSIONED = Pattern.compile(
        "V\\d+_\\d+_\\d+_\\d{3}__(create|drop|rename|add|alter|insert|update|backfill|delete)_[a-z0-9_]+\\.sql");

    private static final Pattern REPEATABLE = Pattern.compile(
        "R__(view|function|procedure|trigger)_[a-z0-9_]+\\.sql");

    @Test
    void shouldFollowTheNamingConventionWhenStoredAsMigration() throws IOException {

        try (Stream<Path> migrations = Files.list(Path.of("src/main/resources/db/migration"))) {
            assertThat(migrations.map(path -> path.getFileName().toString()))
                .allMatch(name -> VERSIONED.matcher(name).matches() || REPEATABLE.matcher(name).matches());
        }
    }

}
```

**S52. Filters become predicates.** A filter is input to the query service, so
it's a record in `application`, next to the read model (see D14), and not a
domain class. That's also why it may select by audit data, such as a creation
date: the read side carries audit data, and the domain never sees it (see D19).
The specification framework of the data store (QueryDSL or JPA Specifications,
MongoDB `Criteria`) translates it in a dedicated, package-private class such as
`ProjectPredicates`.

- It has one entry point that builds the full predicate from the filter.
- It chains one small private method per filter field.
- A field that is null or empty adds no condition, so the method's return type
  is `@Nullable` (see J20).
- Shared conditions, such as date ranges, are reusable helpers.

**S53. QueryDSL with JPA.** Use QueryDSL when possible, because it keeps
predicate classes clear and type-safe. Add its annotation processor to the path
in [B10](#2-build-maven-and-gradle).

```java
// application
public record ProjectFilter(@Nullable Set<ProjectStatus> statuses, @Nullable Instant createdFrom) {}

// persistence
@UtilityClass
class ProjectPredicates {

    private static final QProjectEntity PROJECT = QProjectEntity.projectEntity;

    static Predicate from(ProjectFilter filter) {

        return new BooleanBuilder().and(statusIn(filter.statuses()))
                                   .and(createdFrom(filter.createdFrom()));
    }

    private static @Nullable BooleanExpression statusIn(@Nullable Set<ProjectStatus> statuses) {

        return CollectionUtils.isEmpty(statuses) ? null : PROJECT.status.in(statuses);
    }

    // The creation date lives in the embedded audit data (see S47).
    private static @Nullable BooleanExpression createdFrom(@Nullable Instant createdFrom) {

        return createdFrom == null ? null : PROJECT.audit.createdAt.goe(createdFrom);
    }

}
```

### Caching

**S54. Cache data that can tolerate staleness.** Configuration values, lookup
tables and any other data that changes rarely and can safely be slightly stale
go through Spring Cache.

- **Limit staleness:** every cache has a TTL, and writes use `@CacheEvict`.
- **Mind the cluster:** a local cache such as Caffeine evicts only on its own
  instance, so other instances catch up at the TTL. If that isn't acceptable,
  use a shared cache such as Redis.
- **Mind the proxy:** `@Cacheable` has no effect when a method calls another
  method on the same class.
- **Cache immutable values:** a local cache returns the same instance to every
  caller, so a caller that mutates it changes the cached value.

### HTTP logging

**S55. Zalando Logbook in every environment.** Use Logbook for visibility on raw
HTTP traffic. It stays active in production at `TRACE`, which requires enabling
that one logger explicitly. It must not slow the application down, make it
heavier or fill the logs with personal data:

- In production, log bodies only for failed requests with
  `logbook.strategy: body-only-if-status-at-least`. Bodies of successful
  requests carry personal data that an obfuscation list will never fully catch.
  Full bodies are for non-production environments.
- Limit the size of logged bodies.
- Exclude health checks and binary or large-payload paths. Truncation only
  shortens what gets written, so a body that is too large to buffer must be
  excluded entirely.

**S56. Mask sensitive values.** Logs never contain credentials, tokens or
presigned URLs. Setting a Logbook obfuscation list replaces its defaults, so
list everything explicitly, including `Authorization`.

```yaml
logging:
  level:
    org.zalando.logbook: TRACE

logbook:
  strategy: body-only-if-status-at-least
  minimum-status: 400
  predicate:
    exclude:
      - path: /actuator/**
  write:
    max-body-size: 4096
  obfuscate:
    headers: [Authorization, Cookie, Set-Cookie, X-Api-Key]
    parameters: [access_token, X-Amz-Signature]
    json-body-fields: [password, token, secret]
```

### Outbound HTTP

**S57. One client per remote system.** Every remote HTTP API gets its own
client, named `<Target>HttpClient` and placed in the `client.http` package of
the feature that uses it, for example `payment.client.http.PayPalHttpClient`.

- **It implements a port.** Like a repository (see S44), the client sits behind
  a public driven port in `domain`, named by what the core needs, such as
  `PaymentGateway` (see D6). The port takes and returns domain objects.
  `PayPalHttpClient` implements it, and it and the remote API's DTOs are
  package-private, so no external model leaks into the services. This is the
  anti-corruption layer of D4.
- **Built on `RestClient`, configured the Spring Boot way.** Use an
  `@HttpExchange` interface backed by `RestClient`, or `RestClient` directly,
  and configure it through properties and Spring Boot's builder customizers
  rather than by hand (see S5). With more than two operations, the interface is
  generated from the remote's OpenAPI specification (see S59).
  - **On Boot 4**, an `@HttpExchange` interface belongs to an HTTP service
    group, one per remote system. `@ImportHttpServices` registers it, and Spring
    Boot includes auto-configuration support and configuration properties for
    HTTP Service Clients, configured per group with the pattern
    `spring.http.serviceclient.<group-name>.*` (see S60).
  - **On Boot 3**, and for a client that uses `RestClient` directly, build it
    from Spring Boot's `RestClient.Builder` and bind its base URL and timeouts
    with `@ConfigurationProperties` (see S4 and S60).
- **Always set timeouts.** Connect and read timeouts are explicit for every
  client. A default of "wait forever" isn't acceptable.
- **Authentication through Spring.** OAuth2 client credentials go through Spring
  Security's OAuth2 client support, which obtains and refreshes the token, and
  Spring Security 7 applies it to HTTP service groups. Never build an
  `Authorization` header by hand from a stored token.
- **Logging through Logbook.** Register Logbook's interceptor on the client, so
  outbound traffic follows the same rules as inbound traffic (see S55 and S56).
- **Errors become our errors.** A status handler translates remote errors into
  our exception hierarchy (see S40). The remote body is logged, never returned
  to our client (see S42).
- **Tested with WireMock** when the project has integration tests (see T6).

**S58. Resilience4j for fault tolerance.** When a remote call needs a circuit
breaker, a bulkhead or a rate limiter, use Resilience4j through its Spring Boot
integration, and configure each instance in properties (see S5). For retries
alone, Spring Framework 7 and later has `@Retryable` built in.

- Retry only operations that are safe to repeat: idempotent methods, or calls
  that carry an idempotency key.
- Give each remote system its own named instance, so one failing dependency
  doesn't trip the others.
- A fallback returns something meaningful or fails with a clear error. It never
  hides the failure behind an empty result.

**S59. Generated clients from OpenAPI.** When we call more than two operations
of a remote API that has an OpenAPI specification, the client is generated with
OpenAPI Generator rather than written by hand. For a public product, look for
its specification online first: the vendor's developer portal, its GitHub
organization, or the APIs.guru directory. For an internal service, use the
specification its build generates (see B8). With one or two operations, a
hand-written client is simpler than a generator setup.

- **The specification is committed** under `src/main/resources/openapi/`, so a
  vendor change arrives as a reviewed diff. The generated code isn't committed:
  the build generates it.
- **The paths come from the specification.** A generated interface carries the
  remote's paths, so they aren't repeated in properties. Path properties (see
  S60) are only for hand-written clients.
- **Spring HTTP interfaces.** Use the `spring` generator with the
  `spring-http-interface` library, so the generated interfaces run on our
  configured `RestClient` (see S57). On Boot 3,
  `useHttpServiceProxyFactoryInterfacesConfigurator` generates the class that
  creates them. On Boot 4, register them in the remote's HTTP service group with
  `@ImportHttpServices` instead.
- **Behind the client.** The generated API and models are used only by the
  `<Target>HttpClient` implementation, which maps them to domain objects with a
  MapStruct mapper, so nothing generated leaks into the services.

```xml
<plugin>
  <groupId>org.openapitools</groupId>
  <artifactId>openapi-generator-maven-plugin</artifactId>
  <version>${openapi-generator-maven-plugin.version}</version>
  <executions>
    <execution>
      <id>paypal-payments</id>
      <goals>
        <goal>generate</goal>
      </goals>
      <configuration>
        <inputSpec>${project.basedir}/src/main/resources/openapi/paypal-payments.yaml</inputSpec>
        <generatorName>spring</generatorName>
        <library>spring-http-interface</library>
        <apiPackage>com.company.app.payment.client.http.paypal.api</apiPackage>
        <modelPackage>com.company.app.payment.client.http.paypal.model</modelPackage>
        <configOptions>
          <useSpringBoot3>true</useSpringBoot3>
          <useHttpServiceProxyFactoryInterfacesConfigurator>true</useHttpServiceProxyFactoryInterfacesConfigurator>
          <openApiNullable>false</openApiNullable>
        </configOptions>
      </configuration>
    </execution>
  </executions>
</plugin>
```

On Spring Boot 4, set `useSpringBoot4` instead of `useSpringBoot3`.

**S60. Outbound URLs live in properties.** No URL is written in code. Values
that change per environment come from environment variables.

- **Base URL and timeouts.** On Boot 4, an HTTP service group's properties hold
  them, under `spring.http.serviceclient.<group-name>.*` (see S5 and S57), with
  defaults for every client under `spring.http.clients.*`. On Boot 3, and for a
  client that uses `RestClient` directly, they're our own properties, named as
  S61 describes and bound with `@ConfigurationProperties` (see S4).
- **Paths.** A generated client takes its paths from the specification (see
  S59). A hand-written client reads them from properties, composed with
  placeholders.
- **Many endpoints, one file.** A hand-written client with many endpoints gets
  its own file, such as `carrier-api.properties`, loaded with `@PropertySource`
  the way `api-paths.properties` is (see S62), so `application.properties` stays
  readable.

```properties
### PAYPAL: generated client, Boot 4 HTTP service group ###
spring.http.serviceclient.paypal.base-url=${PAYPAL_API_BASE_URL:https://api-m.sandbox.paypal.com}
spring.http.serviceclient.paypal.connect-timeout=2s
spring.http.serviceclient.paypal.read-timeout=5s
```

```java
@Configuration(proxyBeanMethods = false)
@ImportHttpServices(group = "paypal", types = PaymentsApi.class)
class PayPalHttpClientConfig {
    // Registers the generated PayPal interfaces in the "paypal" group (see S59).
}
```

```properties
### CARRIER: hand-written client ###
carrier.api.protocol=https
carrier.api.host=${CARRIER_API_HOST:api.sandbox.carrier.example}
carrier.api.version=v1
carrier.api.base-url=${carrier.api.protocol}://${carrier.api.host}/${carrier.api.version}
carrier.api.shipments-path=/shipments
carrier.api.shipment-path=${carrier.api.shipments-path}/{shipmentId}
carrier.api.connect-timeout=2s
carrier.api.read-timeout=5s
```

```java
@Configuration(proxyBeanMethods = false)
@PropertySource("classpath:carrier-api.properties")
@EnableConfigurationProperties(CarrierApiProperties.class)
class CarrierHttpClientConfig {
    // Loads the carrier's endpoints and binds them to CarrierApiProperties.
}

@ConfigurationProperties("carrier.api")
record CarrierApiProperties(String baseUrl,
    String shipmentsPath,
    String shipmentPath,
    Duration connectTimeout,
    Duration readTimeout) {}
```

### Configuration files

**S61. Hierarchical property keys.** A property key is a dot-separated path from
the most general segment to the most specific one: the owner (one of our
features, or a remote system), then the area, then the detail, such as
`carrier.api.shipments-path` or `scheduler.order.cleanup.lock-at-most`. Each
segment is lower-case kebab-case. A value used by several keys is defined once
and referenced with `${…}`, so a base path or a host changes in one place, and
keys under one prefix bind to one `@ConfigurationProperties` record (see S4).
Related keys sit together under a comment heading, such as `### CARRIER ###`.
Spring Boot's own keys, such as `spring.http.serviceclient.*`, keep Spring
Boot's names.

**S62. Endpoint paths live in properties files.** Every controller path is a key
in a properties file under `src/main/resources`, loaded by one `@PropertySource`
configuration class, and each mapping annotation references its key as a single
placeholder: no literal paths and no class-level prefix. Public and internal
APIs are kept apart:

- **Public paths** go in `api-paths.properties`, under `api.`. That file lists
  the whole public contract in one place, and S28 to S30 apply to the resolved
  paths.
- **Internal paths**, such as event callbacks and cluster HTTP RPCs (the
  `@Hidden` endpoints of S37), go in `internal-api-paths.properties`, under
  `internal.api.`. They may use verbs, but they're still listed in one place, so
  the internal surface is reviewed and secured as a whole.

The version prefix composes from one base path, which both files share.

```properties
api.v1.version=v1
api.v1.base-path=/api/${api.v1.version}
### PROJECTS ###
api.v1.projects.path=${api.v1.base-path}/projects
api.v1.projects.id.path=${api.v1.projects.path}/{projectId}
api.v1.projects.id.status.path=${api.v1.projects.id.path}/status
api.v1.projects.id.tasks.path=${api.v1.projects.id.path}/tasks
```

```properties
# internal-api-paths.properties
internal.api.v1.callbacks.path=${api.v1.base-path}/internal/callbacks
internal.api.v1.callbacks.order-paid.path=${internal.api.v1.callbacks.path}/order-paid
```

```java
@Configuration
@PropertySource({"classpath:api-paths.properties", "classpath:internal-api-paths.properties"})
class ApiPathsConfig {
    // Loads the controller paths that the mappings reference as ${…} placeholders.
}

@GetMapping("${api.v1.projects.id.path}")
ResponseEntity<ProjectReadDto> getById(@PathVariable Long projectId);

@PutMapping("${api.v1.projects.id.status.path}")
ResponseEntity<ProjectReadDto> changeStatus(@PathVariable Long projectId,
    @RequestBody @Valid ProjectStatusDto projectStatusDto,
    @RequestHeader(HttpHeaders.IF_MATCH) String ifMatch);

// The raw body, stored as it is: the callback always answers 202 (see S37).
@Hidden
@PostMapping("${internal.api.v1.callbacks.order-paid.path}")
ResponseEntity<Void> onOrderPaid(@RequestBody String payload);
```

## 4. Domain-Driven, Hexagonal and Event-Driven Design

This chapter covers three ideas that support each other. Domain-Driven Design
decides what the model is and where its boundaries are. Hexagonal architecture
keeps that model independent of the technology around it. Event-driven design
connects models that must stay apart.

None of this is free. Each pattern below adds types, mappings and indirection,
so apply it where the business logic is complex enough to pay for it (see D3).

### Strategic design

**D1. The ubiquitous language is the code.** Every class, method, event and
error code uses the terms the domain experts use, with the same meaning (see
J5). Keep one glossary per bounded context in the repository, next to the code
it describes, and change the code when the language changes. A term the experts
wouldn't recognize, such as `ProjectManager` or `ProjectHelper`, is a sign the
model is missing a concept.

**D2. Bounded contexts are explicit.** A bounded context is the boundary inside
which one model and one language apply. Write down which bounded contexts a
service contains and how they relate (customer-supplier, conformist,
anti-corruption layer, published language).

- **One model per context.** When a term means different things in two contexts,
  each context has its own class. A `Customer` in sales and a `Customer` in
  billing are separate types that share only an identifier.
- **Contexts don't share domain classes.** They talk through a published service
  interface or through integration events (see D25), never by reaching into each
  other's `domain` package.
- **Features map onto contexts.** A top-level feature package (see S25) belongs
  to exactly one bounded context. Each top-level feature package is a Spring
  Modulith application module, and Modulith verifies that modules access each
  other only through their published API. The check reads the compiled classes
  and needs no Spring context, so it runs with the unit tests (see T4):

```java
class ApplicationModulesTest {

    @Test
    void shouldRespectModuleBoundariesWhenCompiled() {

        ApplicationModules.of(Application.class).verify();
    }

}
```

**D3. Match the effort to the subdomain.** Classify each part of the business as
core (what gives the company its edge), supporting or generic, and record the
classification next to the glossary. Core subdomains get the full treatment:
rich aggregates, application services named after business actions (see S10) and
domain events. Supporting and generic subdomains with little logic may use thin,
form-shaped actions such as `UpdateProjectDetails` (see S10). They keep the
package structure and the ports (see D5), so they can grow into a richer model
later without a rewrite.

**D4. Translate every foreign model at the edge.** A model that we don't own,
such as a remote API, a vendor SDK or another context's events, is translated
into our model by an anti-corruption layer in the adapter that receives it. Its
types never reach `application` or `domain`. The outbound HTTP clients (see S57)
and the message consumers (see D27) are where this translation happens.

### Hexagonal architecture

**D5. A core surrounded by adapters.** Each feature has a core, made of `domain`
and `application`, and adapters around it. The core holds the business logic and
knows nothing about HTTP, databases, brokers or schedulers. Dependencies always
point inward: adapters depend on the core, never the other way around.

| Side    | Role                              | Packages                                               |
| ------- | --------------------------------- | ------------------------------------------------------ |
| Driving | Calls the core                    | `api`, `messaging.in`, `scheduler`                     |
| Core    | Business logic, owns every port   | `application` (driving ports), `domain` (driven ports) |
| Driven  | Called by the core through a port | `persistence`, `client`, `messaging.out`               |

```text
          driving adapters                          driven adapters
   ┌──────────────────────┐                 ┌───────────────────────────┐
   │ api (controllers)    │                 │ persistence               │
   │ messaging.in         │──┐           ┌─▶│  ProjectRepositoryImpl    │
   │ scheduler (jobs)     │  │           │  │  ProjectQueriesImpl       │
   └──────────────────────┘  │           │  │ client.http               │
                             │           │  │  PayPalHttpClient         │
                             ▼           │  └───────────────────────────┘
              ┌──────────────────────────┴───────┐
              │ core                             │
              │  application: ArchiveProject,    │
              │               ProjectQueries     │
              │  domain:      Project, events,   │
              │               domain services,   │
              │               ProjectRepository, │
              │               PaymentGateway     │
              └──────────────────────────────────┘
     Arrows show calls. Every compile-time dependency points into the core.
```

**D6. The core owns its ports, and names them by purpose.**

- **Driving ports** are the public application service and query service
  interfaces in `application` (see S6, S10 and D14). Adapters call them and
  nothing else in the core. Write ports are implemented in `application`; query
  services are implemented in `persistence` (see D14).
- **Driven ports** are interfaces in `domain` that state what the core needs
  from the outside: `ProjectRepository`, `PaymentGateway`, `NotificationSender`.
  The adapter in `persistence` or `client` implements the port, and it stays
  package-private (see S17).
- **Name the need, not the technology.** A port is named after what the core
  wants done, so `PaymentGateway` and never `PayPalClient`. The technology
  appears only in the adapter's name:
  `PayPalHttpClient implements PaymentGateway`.
- **Shape ports for the core.** A port's methods take and return domain objects
  and use domain terms. A port that mirrors a remote API, method for method,
  leaks that API into the core.

**D7. Adapters translate and delegate.** An adapter converts between its
technology and the core, then calls a port. It makes no business decisions, and
adapters never call each other: a controller doesn't call a repository, and a
message consumer doesn't call an HTTP client. Each adapter maps at its own
boundary with its own mapper (see S16), which is the "two-way" mapping strategy.
Its cost is a mapper per boundary; its benefit is that a change in a DTO or an
entity stays inside one package.

**D8. The build enforces the hexagon.** Package-private adapters let the
compiler stop most leaks (see S17). ArchUnit covers the rest:

```java
@ArchTest
static final ArchRule dependenciesPointInward = layeredArchitecture()
    .consideringOnlyDependenciesInLayers()
    .layer("Adapters").definedBy("..api..", "..messaging..", "..persistence..", "..client..", "..scheduler..")
    .layer("Application").definedBy("..application..")
    .layer("Domain").definedBy("..domain..")
    .whereLayer("Adapters").mayNotBeAccessedByAnyLayer()
    .whereLayer("Application").mayOnlyBeAccessedByLayers("Adapters")
    .whereLayer("Domain").mayOnlyBeAccessedByLayers("Application", "Adapters");

@ArchTest
static final ArchRule adaptersAreIndependent = noClasses().that()
    .resideInAPackage("..api..")
    .should().dependOnClassesThat()
    .resideInAnyPackage("..persistence..", "..client..", "..messaging..");

@ArchTest
static final ArchRule messagingSidesAreIndependent = noClasses().that()
    .resideInAPackage("..messaging.in..")
    .should().dependOnClassesThat()
    .resideInAPackage("..messaging.out..");
```

Repeat the second rule for each adapter package. Spring Modulith's module
verification checks the boundaries between features (see D2), and these rules
check the hexagon inside each feature.

### Aggregates

**D9. An aggregate is a consistency boundary.** Group objects into one aggregate
only when a business invariant needs them to change together in one transaction.
Everything else is a separate aggregate.

- **Design small aggregates.** A root entity plus value objects is the common
  case. A large cluster loaded for every change costs memory, locks and
  conflicting writes.
- **Only the root is visible.** Code outside the aggregate holds a reference to
  the root only, and changes inner objects through the root's methods.
- **Don't trust every use case.** A screen that shows two concepts together is
  not an invariant. Read models and joined queries serve the screen (see D14).

**D10. Reference other aggregates by identity.** An aggregate holds the
identifier of another aggregate, never the object: `Project` has an `ownerId`,
not a `User owner`. The same applies to persistence: entities of different
aggregates have no JPA associations between them, only an identifier column.
This keeps aggregates small, makes the transaction boundary visible and lets
aggregates live in different stores or services later.

- **Typed inside a module.** An aggregate of the same module is referenced by
  its typed identifier, such as `ProjectId` (see D22).
- **Plain across modules.** An aggregate of another module or bounded context is
  referenced by the plain value, as in `long ownerId` for a user, so no module
  depends on another's `domain` package (see D2). The compiler can then no
  longer tell an owner from any other `long`, so the field is always named after
  the role, such as `ownerId`, never `id` or `userId`.

**D11. One aggregate per transaction.** A transaction changes one aggregate
instance. When a change in one aggregate must cause a change in another, the
first records a domain event (see D24) and the second reacts in its own
transaction, so the two are eventually consistent. Breaking this rule, for
example because the business truly can't tolerate the delay, is allowed with the
reason written down (see the introduction).

Changing two aggregates in one transaction, with both versions checked, does
work on one database. But reading the second aggregate doesn't protect it: its
version has to be incremented too, so it's written as well. The invariant then
needs both to change together, which by D9 makes them one consistency boundary,
and the model should say so. Vernon puts it the other way round: a rule that
spans aggregates isn't expected to be up to date at every moment (_Effective
Aggregate Design_, part 2), and Khononov reads the need for a multi-aggregate
transaction as a sign of wrong boundaries (_Learning Domain-Driven Design_, ch.
6).

**D12. One repository per aggregate root.** Repositories exist only for roots,
and they load and save the whole aggregate. An inner entity, such as a `Task`
inside a `Project`, has no repository of its own.

**D13. Optimistic locking on the root.** The version lives on the aggregate root
and protects the whole aggregate. Concurrent writes use optimistic locking. The
application service has the aggregate check the version the client expects with
`assertVersion`, which `AggregateRoot` provides (see D24) and which throws
`VersionMismatchException`. Over REST, the version travels as `ETag` and
`If-Match` (see S8).

JPA increments `@Version` only when the root's own columns change. A change
confined to an inner entity, such as adding a task, must still increment the
root's version. The application service loads the root for that change through
`getByIdForUpdate`, which locks it with
`LockModeType.OPTIMISTIC_FORCE_INCREMENT` (see S44). `update` then finds the
same locked entity in the persistence context, and the commit increments the
version.

```java
// ProjectJpaRepository: Spring Data ignores "Locked", between "find" and "By"
@Lock(LockModeType.OPTIMISTIC_FORCE_INCREMENT)
Optional<ProjectEntity> findLockedById(Long id);

// ProjectRepositoryImpl
@Override
public Project getByIdForUpdate(ProjectId projectId) {

    return projectJpaRepository.findLockedById(projectId.value())
                               .map(projectEntityMapper::toDomain)
                               .orElseThrow(() -> new ProjectNotFoundException(projectId));
}

// AddTaskService: the change touches only an inner entity
@Override
@Transactional
public void execute(AddTaskCommand command) {

    final Project project = projectRepository.getByIdForUpdate(command.projectId());
    project.assertVersion(command.expectedVersion());

    project.addTask(command.title());

    projectRepository.update(project);
}
```

**D14. Reads bypass the aggregate.** An aggregate exists to protect invariants
while it changes, and a read changes nothing. Reads therefore go through a query
service, the query side of a lightweight CQRS: both sides use the same tables,
but each has its own model.

- **The port.** `ProjectQueries` is a driving port in `application` that returns
  `ProjectReadModel` records. A read model is shaped for what the client shows:
  it carries the version and the audit data (see S47), may join data from
  several tables in one query (see S49), and has no behavior.
- **Named apart from the use cases.** A query port is named
  `<Aggregate>Queries`, never `*Service`: `Service` is the suffix of application
  service implementations only (see J8 and S10). The books draw the same line.
  Hombergs names query ports `GetAccountBalanceQuery` and keeps `UseCase` for
  the write side (_Get Your Hands Dirty on Clean Architecture_, ch. 4), and
  Buenosvinos and his co-authors treat reads as an infrastructure concern that
  needs no command (_DDD in PHP_, ch. 2 and 12).
- **The implementation.** `ProjectQueriesImpl` lives in `persistence`,
  package-private, and reads the entities, a projection or plain SQL directly.
  Implementing a driving port in an adapter is a deliberate shortcut: it saves a
  query service in the core whose only job would be to call a driven port. When
  a read needs business logic, such as a computed balance, write
  `ProjectQueriesImpl` in `application` instead, annotated `@Component` rather
  than `@Service` (see S12), and give it a driven port.
- **Writes don't decide on reads.** An application service loads the aggregate
  through its repository, never a read model, because a read model can be stale
  and isn't locked.
- **Separate read stores only when needed.** A read model in another store,
  updated from domain events, is eventually consistent. Use it only when the
  queries need it, and then answer writes with `202 Accepted` or a `Location`
  header instead of reading the result back (see S8).

### Domain objects

**D15. Plain Java.** Domain classes have no framework leakage: no Spring, JPA,
Jackson or Bean Validation. That also excludes Spring Data's
`AbstractAggregateRoot` and `@DomainEvents`. Two compile-time aids are allowed
because they add no runtime behavior: Lombok and JSpecify's nullability
annotations (see J20). Domain code doesn't read the system clock or generate
random values either. The service passes the current `Instant` from an injected
`Clock`, so tests control time. The one exception is the identifier of a domain
event, which `AggregateRoot` generates (see D24). It has no business meaning,
and tests compare events with it ignored.

Domain exceptions follow the same rule: they carry a category and a code, never
an HTTP status (see S40). ArchUnit checks the whole list:

```java
@ArchTest
static final ArchRule domainIsPlainJava = noClasses().that()
    .resideInAPackage("..domain..")
    .should().dependOnClassesThat()
    .resideInAnyPackage("org.springframework..", "jakarta..", "com.fasterxml..", "tools.jackson..",
        "..shared.error..");
```

**D16. Creation goes through a factory named in the language.** An aggregate is
created through a static factory method named after the domain action that
creates it, such as `Project.draft(...)`, never through a public constructor.
The factory takes the identifier and the minimum set of mandatory values that
makes the aggregate coherent, applies the creation rules and records the
creation event. Other fields get default values where that makes sense.
Free-form optional values may have setters (see D17). Nothing else does.

**D17. Behavior protects invariants.** State with rules attached, such as a
status, changes only through behavior methods named in the ubiquitous language,
such as `archive()` rather than `setStatus(ARCHIVED)`. The method checks the
rule, changes the state and records the domain event in one place. Callers tell
the aggregate what to do; they don't read its state, decide, and write it back.
Setters are kept for free-form optional values with no rules, such as a
description.

**D18. Step builders for many mandatory fields.** When an object has many
mandatory values, a constructor stops being readable. Prefer the Step Builder
pattern (also called the Staged or Typesafe Builder), which makes the compiler
reject a missing mandatory field. Lombok's `@Builder` can't do this, so write it
by hand or generate it with a tool such as Jilt. Each step method states the
nullability of its argument (see J20). Commands always use one, and S11 shows
the shape.

**D19. Identity from the start; technical data stays outside.** Each kind of
field has one owner:

| Field                                    | In the aggregate   | Set by                                              |
| ---------------------------------------- | ------------------ | --------------------------------------------------- |
| Identifier                               | Yes, from creation | The repository's `nextIdentity()` (see S45)         |
| Business time (`archivedAt`)             | Yes                | The aggregate, from an `Instant` the service passes |
| Version                                  | Yes, read-only     | Persistence, through reconstitution (see D13)       |
| Audit data (`createdAt`, `createdBy`...) | No                 | Persistence only; read models carry it (see D14)    |

- **Early identity.** The application service asks the repository for the next
  identity and passes it to the creation factory, so an aggregate is never
  without its identifier and can record its creation event. The aggregate never
  generates the identifier itself (see D15).
- **The version is the one technical field.** It stays on the root because the
  write side compares it with `If-Match` (see S8). The aggregate never changes
  it.
- **Reconstitution is not creation.** A stored aggregate is rebuilt through a
  separate factory, `reconstitute`, which the entity mapper calls (see S23). It
  takes the stored identifier and state, applies no creation rules and records
  no events. Stored state that breaks an invariant is an error to report with
  the aggregate's identifier, not a value to correct silently.
- **Only the persistence adapter reconstitutes.** Java can't hide a public
  method from one package, so ArchUnit restricts the callers:

```java
@ArchTest
static final ArchRule onlyPersistenceReconstitutes = noClasses().that()
    .resideOutsideOfPackage("..persistence..")
    .should().callMethodWhere(JavaCall.Predicates.target(HasName.Predicates.name("reconstitute")));
```

```java
@Getter
public class Project extends AggregateRoot<ProjectId> {

    // Facts of the domain that the commands and DTOs reference (see S34).
    public static final int NAME_MAX_LENGTH = 120;

    public static final int DESCRIPTION_MAX_LENGTH = 2000;

    private final ProjectId id;

    private String name;

    // A user of another module, referenced by its plain identifier (see D10).
    private final long ownerId;

    private ProjectStatus status = ProjectStatus.DRAFT;

    @Setter
    private @Nullable String description;

    // Null until the aggregate is first stored. Only reconstitute sets it.
    private @Nullable Long version;

    private Project(ProjectId id, String name, long ownerId) {

        this.id = Objects.requireNonNull(id);
        this.name = Objects.requireNonNull(name);
        this.ownerId = ownerId;
    }

    // Creation: a new project, with its rules and its event.
    public static Project draft(ProjectId id, String name, long ownerId, Instant draftedAt) {

        final Project project = new Project(id, name, ownerId);
        project.registerEvent(new ProjectDrafted(project.newEventId(), id, ownerId, draftedAt));

        return project;
    }

    // Reconstitution: a stored project, with no rules and no events.
    public static Project reconstitute(ProjectId id,
        String name,
        long ownerId,
        ProjectStatus status,
        @Nullable String description,
        long version) {

        final Project project = new Project(id, name, ownerId);
        project.status = Objects.requireNonNull(status);
        project.description = description;
        project.version = version;

        return project;
    }

    public boolean isActive() {

        return status == ProjectStatus.ACTIVE;
    }

    public void rename(String name) {

        this.name = Objects.requireNonNull(name);
    }

    public void archive(Instant archivedAt) {

        status = status.transitionTo(ProjectStatus.ARCHIVED);
        registerEvent(new ProjectArchived(newEventId(), id, archivedAt));
    }

}

// Application service
@Service
@RequiredArgsConstructor
class DraftProjectService implements DraftProject {

    private final ProjectRepository projectRepository;

    private final Clock clock;

    @Override
    @Transactional
    public ProjectId execute(DraftProjectCommand command) {

        final Project project = Project.draft(projectRepository.nextIdentity(),
                                              command.name(),
                                              command.ownerId(),
                                              clock.instant());
        projectRepository.save(project);

        return project.getId();
    }

}
```

**D20. Domain services hold rules that belong to no single aggregate.** When a
business rule needs several aggregates, and putting it on one of them would be
forced, it becomes a domain service (Evans, _Domain-Driven Design_, ch. 5;
Vernon, _Implementing Domain-Driven Design_, ch. 7): a stateless class in
`domain`, named in the ubiquitous language after the rule, such as
`BudgetAllocationPolicy`.

- **Plain Java.** No `@Service`, `@Component` or `@Transactional` (see D15). It
  receives aggregates and values, and decides or calls their behavior. It never
  loads or saves: the application service does that around it.
- **Registered outside the domain.** A package-private `@Configuration` in the
  feature's `config` package declares it as a `@Bean`, so application services
  can inject it.
- **Not the first resort.** Evans warns that pushing behavior into services
  empties the entities. Try the aggregate first.
- **The invariant stays inside one aggregate.** A domain service may read
  several aggregates, but the aggregate it changes is the one whose invariant is
  at stake, so that aggregate's version protects it (see D9 and D13). The
  aggregates it only reads can change in a concurrent transaction. A rule about
  them is eventually consistent, and an event repairs it (see D11).

In the example, the budget invariant needs every allocation of a portfolio to
change together, so it lives in `Portfolio`, and two concurrent allocations
conflict on its version. The project is only read. If it's archived in a
concurrent transaction, a listener on `ProjectArchived` calls the
`ReleaseProjectAllocation` action. Both aggregates belong to the `project`
feature, so they reference each other by typed identifier (see D10).

```java
// domain
public class BudgetAllocationPolicy {

    public void allocate(Portfolio portfolio, Project project, Money amount, Instant allocatedAt) {

        if (!project.isActive()) {
            throw new ProjectNotActiveException(project.getId());
        }

        // Only the portfolio changes, so one aggregate per transaction holds (see D11).
        portfolio.allocate(project.getId(), amount, allocatedAt);
    }

}

// domain: the portfolio owns the invariant on its budget
public void allocate(ProjectId projectId, Money amount, Instant allocatedAt) {

    if (remainingBudget().isLessThan(amount)) {
        throw new PortfolioBudgetExceededException(id, amount);
    }

    allocations.merge(projectId, amount, Money::add);
    registerEvent(new BudgetAllocated(newEventId(), id, projectId, amount, allocatedAt));
}

// config
@Configuration(proxyBeanMethods = false)
class ProjectDomainConfig {

    @Bean
    BudgetAllocationPolicy budgetAllocationPolicy() {

        return new BudgetAllocationPolicy();
    }

}
```

**D21. Explicit state machines.** Lifecycles are explicit state machines with
validated transitions. The allowed transitions live in one table on the status
type, and an invalid transition throws a coded domain error (see S41).

```java
public enum ProjectStatus {

    DRAFT,
    ACTIVE,
    ARCHIVED;

    // @formatter:off
    private static final Map<ProjectStatus, Set<ProjectStatus>> TRANSITIONS = Map.of(
        DRAFT,    Set.of(ACTIVE, ARCHIVED),
        ACTIVE,   Set.of(ARCHIVED),
        ARCHIVED, Set.of());
    // @formatter:on

    public ProjectStatus transitionTo(ProjectStatus target) {

        if (!TRANSITIONS.get(this).contains(target)) {
            // An InvalidStateException, so the API answers 409 (see S40).
            throw new InvalidProjectTransitionException(this, target);
        }

        return target;
    }

}
```

### Value objects

**D22. Value objects are immutable records.** A concept that is defined by its
values and has no identity of its own, such as `Money`, `DateRange` or
`EmailAddress`, is a value object.

- **Records.** Write value objects as records, so they are immutable and compare
  by value.
- **Self-validating.** The compact constructor rejects invalid values, so an
  invalid value object can't exist.
- **Behavior belongs to the value.** Operations on the value live on the value
  object, such as `Money.add` or `DateRange.overlaps`, instead of in services.
- **Replace, don't mutate.** An aggregate changes a value object by replacing it
  with a new instance.
- **Only where there's a rule.** Introduce a value object when the concept has
  validation or behavior. A free-form `String` such as a description stays a
  `String`.
- **Identifiers are value objects.** Every aggregate identifier is a record
  named `<Aggregate>Id`, such as `ProjectId`, in that aggregate's `domain`
  package. Every reference to another aggregate of the same module uses its
  type, as `Portfolio` does with `ProjectId`, so the compiler rejects a
  portfolio identifier passed where a project identifier belongs. A reference to
  another module's aggregate is the plain value (see D10). This follows Vernon
  (`ProductId`, _Implementing Domain-Driven Design_, ch. 5 and 10) and
  Buenosvinos and his co-authors (_DDD in PHP_, ch. 4).
- **Typed identifiers stop at the core's edge.** DTOs and entities carry the
  underlying `Long`, so JPA, Spring Data and the sequence stay simple. One
  converter per identifier, such as `ProjectIdMapper`, serves every mapper of
  the feature (see S19).

```java
public record ProjectId(long value) {

    public ProjectId {

        if (value <= 0) {
            // An InvalidValueException, so the API answers 400 (see S40).
            throw new InvalidIdentifierException("project", value);
        }
    }

}
```

```java
public record Money(BigDecimal amount, Currency currency) {

    public Money {

        Objects.requireNonNull(amount);
        Objects.requireNonNull(currency);

        if (amount.scale() > currency.getDefaultFractionDigits()) {
            throw new InvalidMoneyException(amount, currency);
        }
    }

    public Money add(Money other) {

        if (!currency.equals(other.currency)) {
            throw new CurrencyMismatchException(currency, other.currency);
        }

        return new Money(amount.add(other.amount), currency);
    }

    public boolean isLessThan(Money other) {

        if (!currency.equals(other.currency)) {
            throw new CurrencyMismatchException(currency, other.currency);
        }

        return amount.compareTo(other.amount) < 0;
    }

}
```

**D23. Group what belongs together.** Values that form one concept in the domain
are one type in every layer: a value object in the domain (see D22), a nested
DTO in the API, an `@Embeddable` in a JPA entity and an embedded document in
MongoDB. An address is an `Address`, never `addressStreet`, `addressCity` and
`addressZipCode` side by side. Each layer maps the group with one mapper method.
`AuditEmbeddable` (see S47) is one such group.

The grouping exists in the object model, not in the schema: the group's values
stay columns of the owning table, so reading it costs no join. That's what
`@Embeddable` does in JPA and `@Embedded` does in Spring Data JDBC. With jOOQ or
hand-written SQL, the mapper builds the value object from those columns. Never
give a value object a table of its own.

```java
// domain
public record Address(String street, String city, String zipCode) {

    public Address {

        Objects.requireNonNull(street);
        Objects.requireNonNull(city);
        Objects.requireNonNull(zipCode);
    }

}

// persistence: constructors, accessors and NullAway as in S15
@Entity
class CustomerEntity {

    // ...

    @Embedded
    private AddressEmbeddable address;

}

@Embeddable
@Getter
@Setter
class AddressEmbeddable {

    private String street;

    private String city;

    private String zipCode;

    @SuppressWarnings("NullAway.Init")
    AddressEmbeddable() {
        // For JPA and MapStruct, which fill the fields after construction.
    }

}
```

### Domain events

**D24. Aggregates record events; repositories publish them.** A domain event
states a business fact that already happened, named in the ubiquitous language
and in the past tense: `ProjectArchived`, never `ArchiveProject` or
`ProjectEvent`. It is an immutable record in `domain` that implements the
`DomainEvent` interface from `shared.domain`, and carries its own identifier,
the aggregate's identifier, the time it happened and the data that describes the
fact.

- **Recording.** The behavior method that changes the state also records the
  event, through `registerEvent` on `AggregateRoot` in `shared.domain`. The
  domain stays plain Java (see D15).
- **Identified once, at birth.** The event gets its identifier from
  `newEventId()`, which `AggregateRoot` provides, when the aggregate records it.
  The identifier is stored with the event in the publication registry (see D26),
  so every redelivery carries the same one, and consumers can deduplicate on it
  (see D27). It's inherited, never injected: aggregates aren't Spring beans, and
  a generator passed into every behavior method would clutter the model.
  Buenosvinos and his co-authors give stored events an identifier for the same
  reason: to track which ones were published and which went missing (_DDD in
  PHP_, ch. 6).
- **Publishing.** The repository adapter publishes them in `save` and `update`,
  in the caller's transaction, through `AggregateEvents` in
  `shared.persistence`, which wraps Spring's `ApplicationEventPublisher`. No
  application service can forget, and none needs a base class for it (see S12).
  The cost is a side effect inside `save`, so the repository port's Javadoc
  states it.
- **Creation events.** The creation factory records the creation event like any
  other, because the aggregate has its identifier from the start (see D19).
- **Reacting.** A listener in another aggregate or module reacts in its own
  transaction (see D11). Use Spring Modulith's `@ApplicationModuleListener`,
  which runs after commit, in a new transaction, through the event publication
  registry (see D26).
- **Spring Modulith is mandatory.** Aggregates react to each other only through
  events, each in its own transaction (see D11). A plain `@EventListener` runs
  inside the publisher's transaction, and a `@TransactionalEventListener` loses
  the event if the application stops after the commit. The publication registry
  is what makes D11 safe, and it's also the outbox of D26. A project with one
  aggregate uses it too: a second aggregate usually follows, and the module
  check of D2 pays for the dependency on its own.
- **Every listener is idempotent.** The registry can deliver an event to a
  listener more than once, so an internal listener deduplicates like a broker
  consumer (see D27).

```java
// shared.domain
public interface DomainEvent {

    UUID eventId();

    Instant occurredAt();

}

// project.domain
public record ProjectArchived(UUID eventId, ProjectId projectId, Instant occurredAt) implements DomainEvent {}

// shared.domain
public abstract class AggregateRoot<ID> {

    private final List<DomainEvent> domainEvents = new ArrayList<>();

    public abstract ID getId();

    public abstract @Nullable Long getVersion();

    public void assertVersion(long expectedVersion) {

        if (!Objects.equals(getVersion(), expectedVersion)) {
            throw new VersionMismatchException(getClass().getSimpleName(), getId(), expectedVersion);
        }
    }

    public List<DomainEvent> pullDomainEvents() {

        final List<DomainEvent> pulled = List.copyOf(domainEvents);
        domainEvents.clear();

        return pulled;
    }

    // The one random value in the domain (see D15).
    protected UUID newEventId() {

        return UUID.randomUUID();
    }

    protected void registerEvent(DomainEvent domainEvent) {

        domainEvents.add(Objects.requireNonNull(domainEvent));
    }

}

// shared.persistence
@Component
@RequiredArgsConstructor
public class AggregateEvents {

    private final ApplicationEventPublisher eventPublisher;

    // Runs in the caller's transaction, so the outbox records the events (see D26).
    public void publishFrom(AggregateRoot<?> aggregate) {

        aggregate.pullDomainEvents().forEach(eventPublisher::publishEvent);
    }

}

// Application service: no event code at all
@Override
@Transactional
public void execute(ArchiveProjectCommand command) {

    final Project project = projectRepository.getById(command.projectId());
    project.assertVersion(command.expectedVersion());

    project.archive(clock.instant());

    projectRepository.update(project);
}
```

**D25. Domain events are private; integration events are a contract.** A domain
event describes our model and may change whenever the model does. Other bounded
contexts and systems never receive it directly. They receive an integration
event: a separate type in `messaging.out`, designed as part of our published
language, versioned (see D28) and mapped from the domain event by the publishing
adapter.

- **Publish deliberately.** Only events another context needs become integration
  events. Most domain events stay internal.
- **Choose the payload on purpose.** An event notification carries identifiers
  and the consumer queries for the rest. Use it when the consumer needs the
  latest state or the data is sensitive. Event-carried state transfer carries
  the changed state, so the consumer can keep a local copy and keep working when
  we're down. Use it when the consumer can accept eventually consistent data.
- **No entity dumps.** An integration event never serializes an entity or an
  aggregate as it is, because that turns our internal model into someone else's
  contract.

**D26. Transactional outbox across systems.** Whenever a change in our database
must go together with an effect on another system, such as publishing an event,
sending a message or calling another service, use the transactional outbox
pattern. The change and an outbox record are written in the same local
transaction, and a separate relay delivers the record afterwards, retrying until
it succeeds. Never write to the database and then publish or call in sequence,
and never use distributed transactions (XA or two-phase commit).

Spring Modulith's event publication registry is the outbox, in every project
(see D24). Set it up once:

- **Starter.** Use `spring-modulith-starter-jpa`, or the JDBC starter on a
  project without JPA, so publications are written in the same transaction as
  the change.
- **Schema through migrations.** Create the `event_publication` table with a
  migration, like every other schema change (see S51), and leave
  `spring.modulith.events.jdbc.schema-initialization.enabled` at `false`.
  Modulith's reference documentation lists the table per database.
- **Completed publications are deleted.** Set
  `spring.modulith.events.completion-mode=delete`, so the table holds only what
  is still in flight. Use `archive` instead when completed publications must be
  kept for inspection.
- **Incomplete publications are resubmitted by a job.** Keep
  `spring.modulith.events.republish-outstanding-events-on-restart` at `false`:
  in a cluster, other instances may still be processing those events. A
  scheduled job calls `IncompleteEventPublications` to resubmit publications
  older than a configured age, behind a distributed lock (see D29).
- **Events serialize to JSON.** The registry stores each event as JSON, so a
  domain event holds only records, value objects and plain values (see D22 and
  D24).

```properties
spring.modulith.events.jdbc.schema-initialization.enabled=false
spring.modulith.events.completion-mode=delete
spring.modulith.events.republish-outstanding-events-on-restart=false
```

Modulith's event externalization delivers events to a broker after commit.
Configure the externalization in the `messaging.out` adapter with
`EventExternalizationConfiguration`, mapping each domain event to its
integration event (see D25), rather than annotating domain events with
`@Externalized`, which would put Modulith into `domain` (see D15). The receiving
side must be idempotent (see D27), because the relay can deliver a record more
than once.

**D27. Idempotent, order-tolerant consumers.** A consumer is a driving adapter
in `messaging.in`, in two steps. Receiving stores the message, as it arrived
from a broker or an internal callback (see S37), in an inbox table. Processing
reads the inbox, translates the message into our model (see D4), builds the
command and calls an application service.

- **Receive without judging.** Receiving checks nothing in the content. A
  callback answers `202` once the message is in the inbox (see S37).
- **Validate through the command.** The command validates itself (see S34). A
  message that the translation or the command rejects is invalid for good: it
  goes to the dead-letter table with the reason, logged at `warn`, and is never
  retried.
- **Deduplicate in the same transaction.** Mark the event identifier as
  processed in the same transaction as the effect, and skip an identifier that
  is already processed. A natural idempotency key, such as an order number,
  works too.
- **Don't assume order.** Brokers can redeliver and reorder. Compare the
  aggregate version or the event time carried by the event with what is stored,
  and ignore stale events instead of overwriting newer state.
- **Nothing is lost silently.** A message that keeps failing for a technical
  reason is retried with backoff, then goes to the dead-letter table with its
  error. Every dead-lettered message can be inspected and replayed. Log
  identifiers, not payloads (see S43).

**D28. Versioned schemas.** Integration event schemas are versioned and live in
the repository, as JSON Schema, Avro or AsyncAPI.

- Every integration event carries an envelope: event identifier, type, schema
  version, occurrence time and the aggregate's identifier. The event identifier
  is the domain event's `eventId` (see D24), never one generated while mapping,
  because the mapping runs again on every redelivery.
- Changes are backward compatible: add optional fields, never rename, remove or
  change the meaning of one. A breaking change is a new version, published next
  to the old one until every consumer has moved.
- The build checks the schema against the committed file, like the OpenAPI
  contract (see B8).

### Background work

**D29. Safe scheduled jobs.** Scheduled jobs are driving adapters in
`scheduler`: they call an application service and contain no business logic. In
a cluster, they use a distributed lock, such as ShedLock, and each job has its
own on/off switch in configuration. A job builds its commands like any other
adapter, so they validate themselves (see S34). A command the job can't build is
a bug in the job, logged at `error`.

## 5. Testing

**T1. Test every branch.** All code branches are tested.

**T2. Readable tests.** Name test classes `<Subject>Test` (not `*Tests` or
`*IT`), name tests `shouldXWhenY`, group them with `@Nested` and `@DisplayName`,
and assert with AssertJ.

**T3. Parameterize.** When several tests share the same logic and differ only in
their data, write one parameterized test instead.

**T4. Unit tests are mandatory.** Unit tests cover the domain, the application
services, the commands' validation (see S34) and the mappers. A mapper test
builds the generated implementation with its converters, such as
`new ProjectEntityMapperImpl(new ProjectIdMapper(), ...)`, and checks the
reconstitution and the constructor MapStruct chose (see S15 and S23), with no
Spring context and no database.

**T5. Integration tests are optional.** Unit tests are the required suite.
Integration tests are a choice per project, so T6 is a set of hints, not rules,
and nothing in the build requires them.

**T6. Hints for integration tests.** When a project has them, or before it adds
them:

- **The cheapest guarantee is a Bruno collection.** Keep a Bruno collection of
  the API in the repository, next to the OpenAPI specification (see B8), with
  assertions on status codes, `ETag` and error codes. Run it with the Bruno CLI
  against a running instance, locally or after a deployment. It exercises the
  routing, the validation, the JSON, the error model and the real database
  together, without any test infrastructure in the build.
- **Slice tests, where a layer earns one.** Controllers with `@WebMvcTest` or
  the GraphQL tester, outbound HTTP clients against WireMock, including timeouts
  and remote errors, and repositories with the data store's slice test, such as
  `@DataJpaTest`. The repository round trip (`save`, `getById`, `update`,
  `getById`) covers what unit tests can't: the dirty-checked update and the
  change history (see S8 and S48).
- **The production engine, never a substitute.** A repository test runs on the
  same database engine and major version as production. An in-memory database
  such as H2 can't run native migrations or native queries, such as sequences
  (see S45 and S51).
- **Testcontainers, or a fallback.** A container with `@ServiceConnection` needs
  no further configuration. Where CI can't run containers, use a database
  service of the CI system itself, such as a GitHub Actions or GitLab CI service
  container, with `@AutoConfigureTestDatabase(replace = Replace.NONE)`, or the
  engine's own binaries started without Docker, such as zonky's embedded
  PostgreSQL.

**T7. No shortcuts.** Never mock value objects or DTOs, and never set fields by
reflection.
