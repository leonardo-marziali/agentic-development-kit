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
- [4. Domain-Driven and Event-Driven
  Design](#4-domain-driven-and-event-driven-design)
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
JPA entities (see [S15](#models)).

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

**J26. Builders for long argument lists.** A method with more than seven
parameters takes one parameter object instead, built with a fluent builder, so
every value is named at the call site. Better still, also accept a `Consumer`
of that builder, the way the AWS SDK v2 configures its requests: the caller
fills in only what it needs inside a lambda, and the method builds the object.
A constructor with that many parameters needs a builder too (a step builder
for mandatory values, see D4), or, when they're injected dependencies, a
split class. An `@Override` keeps the signature it inherits, and a record's
canonical constructor mirrors its components.

```java
public interface ReportGenerator {

    Report generate(ReportRequest request);

    default Report generate(Consumer<ReportRequest.Builder> request) {

        ReportRequest.Builder builder = ReportRequest.builder();
        request.accept(builder);
        return generate(builder.build());
    }

}

reportGenerator.generate(request -> request.projectId(projectId)
    .period(period)
    .format(ReportFormat.PDF));
```

With Lombok, `@Builder(builderClassName = "Builder")` on the record names the
builder `ReportRequest.Builder`.

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
- Services expose a public interface, with a package-private implementation in
  the same package.
- Internal collaborators are package-private classes with no interface.
  Interfaces exist only at package boundaries.
- Repositories follow the same pattern (see [S44](#persistence)).

### Layers and flow

**S7. Domain objects cross the layers.** The public interfaces of services and
repositories expose only domain objects, as input and output. DTOs stop at the
controller and entities stop at the repository. Spring Data's `Pageable` and
`Page` are the one accepted exception on these interfaces (see
[Pagination](#pagination)). They never appear inside domain classes.

**S8. The standard flow.** A typical update works like this:

1. **Controller**: orchestrates.
   1. Maps the write DTO to a domain object that carries the requested changes.
   2. Reads the expected version from `If-Match` (see S27).
   3. Calls `ProjectService`, or several services if needed.
   4. Maps the result to a read DTO and returns the new version as `ETag`.
2. **Service**: in one transaction, loads the current aggregate, checks the
   expected version, applies the changes through domain behavior (see D3), and
   hands the aggregate to the repository. The domain, not the mapper, decides
   which fields an update may touch.
3. **Repository**: copies the aggregate onto the entity, saves it, and maps the
   result back to a domain object.

The version and the audit data travel up the layers the same way the identifier
does (see D5): the persistence layer fills them, the domain object carries them
read-only, and the API exposes them. The version reaches the client as the
`ETag` and comes back as `If-Match`.

```java
// Controller
@Override
public ResponseEntity<ProjectReadDto> update(Long projectId, String ifMatch,
    ProjectWriteDto projectWriteDto) {

    Project changes = projectApiMapper.toDomain(projectWriteDto);
    Project updatedProject = projectService.update(projectId, changes, ETags.toVersion(ifMatch));
    Map<Long, UserSummary> usersById = userService.findSummaries(Set.of(updatedProject.getOwnerId()));

    return ResponseEntity.ok()
                         .eTag(ETags.of(updatedProject.getVersion()))
                         .body(projectApiMapper.toReadDto(updatedProject, usersById));
}

// Service implementation
@Override
@Transactional
public Project update(Long id, Project changes, long expectedVersion) {

    Project project = projectRepository.findById(id);

    if (!Objects.equals(project.getVersion(), expectedVersion)) {
        throw new ProjectVersionMismatchException(id, expectedVersion);
    }

    project.rename(changes.getName());
    project.setDescription(changes.getDescription());

    return projectRepository.update(project);
}

// Repository implementation
@Override
public Project update(Project project) {

    /*
     * The service loaded this entity in the same transaction, so the persistence
     * context returns it without a second query. If another transaction commits
     * between the version check and the flush, @Version fails the flush.
     */
    ProjectEntity projectEntity = projectJpaRepository.findById(project.getId())
                                                      .orElseThrow(() -> new ProjectNotFoundException(project.getId()));

    projectEntityMapper.updateEntity(project, projectEntity);

    return projectEntityMapper.toDomain(projectJpaRepository.save(projectEntity));
}
```

`ProjectVersionMismatchException` and Spring's
`ObjectOptimisticLockingFailureException` both map to
`412 Precondition Failed`. A missing `If-Match` on an update returns
`428 Precondition Required` (RFC 6585). `ETags` in `shared.web` converts between
a version and a strong `ETag` value.

**S9. Limits of controller orchestration.** A controller may call several
services in sequence, but it makes no business decisions. Each service call runs
in its own transaction, so a flow that must be atomic or has real business steps
belongs in a use case service (see S11).

### Services

**S10. Small entity services.** A service named `<DomainEntity>Service` contains
only CRUD methods and other simple operations, such as a simple clone. Avoid
large services with many methods.

**S11. One service per use case.** A business process with many steps gets its
own class, following the Use Case or Interactor pattern from Robert Martin's
_Clean Architecture_: one class per use case, orchestrating entities and
gateways. Name it `<DomainEntity><Process>UseCase`, for example
`OrderPreparationUseCase`. It exposes a single public method, always named
`handle`, so every use case is invoked the same way.

`handle` never takes separate arguments. Its input is one command,
`<DomainEntity><Process>Command`: a record next to the use case that carries
everything the process needs, built with a fluent builder (Lombok's
`@Builder`, or a step builder when the values are mandatory, see D4). The use
case may also offer the `Consumer` overload of J26. A use case without input,
such as a scheduled one, has `handle()`. ArchUnit checks both the signature
and the command's static `builder()`.

```java
orderPreparationUseCase.handle(OrderPreparationCommand.builder()
    .orderId(orderId)
    .warehouseId(warehouseId)
    .build());

orderPreparationUseCase.handle(command -> command.orderId(orderId)
    .warehouseId(warehouseId));
```

**S12. Services work on the domain.** Entity and use case services alike
handle only domain objects. They pass those objects to the repository layer,
which maps them to entities and stores them.

### Models

**S13. The model set.** A domain concept can have up to six models, and exists
only in the forms it needs. For `Project`:

| Model              | Layer       | Purpose                                 |
| ------------------ | ----------- | --------------------------------------- |
| `ProjectReadDto`   | API         | Response body, when reads are needed    |
| `ProjectWriteDto`  | API         | Request body, when writes are needed    |
| `ProjectFilterDto` | API         | Query params, when filtering is needed  |
| `Project`          | Domain      | Domain object, always                   |
| `ProjectFilter`    | Domain      | Domain filter, when filtering is needed |
| `ProjectEntity`    | Persistence | Persistence model, when persisted       |

**S14. DTO style.** Read DTOs are immutable: use Lombok's `@Value` with
`@Builder`, because builders are more readable than constructors. Write and
filter DTOs use `@Data`. DTOs prefer composition over inheritance.

**S15. Entity style.** Never expose fields managed by the framework
(identifiers, audit data, version) through constructors or setters, and use
`@Setter(AccessLevel.NONE)` on them. Don't use `@Data`, `@EqualsAndHashCode` or
`@ToString` on entities: on lazy associations they trigger proxy initialization,
and on bidirectional relations they recurse forever. If an entity needs
`equals`, base it on the identifier and write it by hand.

### Mapping

**S16. One mapper per layer boundary.** Each domain object has one MapStruct
mapper per layer it crosses into: `ProjectApiMapper` maps between the DTOs and
the domain object and filter, and `ProjectEntityMapper` maps between the domain
object and the entity. Mappers never access the database. Any data they need is
loaded beforehand and passed through `@Context`.

**S17. Mappers live with what they map.** Each mapper sits in the same package
as the types it maps and the only code that uses it, so the compiler enforces
the boundary instead of ArchUnit:

- `api` holds the controllers, the DTOs and `ProjectApiMapper`, all
  package-private.
- `persistence` holds `ProjectRepositoryImpl`, `ProjectJpaRepository`,
  `ProjectEntity`, `ProjectEntityMapper` and `ProjectPredicates`, all
  package-private. Only the `ProjectRepository` interface is public.
- DTOs and entities can't leak into `service` or `domain`, because nothing
  outside their package can see them. ArchUnit still checks what the compiler
  can't, such as domain purity (see D1).

Converters shared across features, such as `DateMapper`, are the exception: they
live in `shared.mapping` and are public.

**S18. Arguments before `@Mapping`.** MapStruct matches a method's arguments
to target properties by name. A value that isn't on the source object is passed
as an argument named after the target property. Write `@Mapping` only when the
names can't be aligned.

```java
// Preferred: tenantId matches the target property by name
ProjectEntity mapToEntity(Project project, String tenantId);

// Avoid: the mapping only exists to fix a name that could have matched
@Mapping(target = "tenantId", source = "currentTenant")
ProjectEntity mapToEntity(Project project, String currentTenant);
```

**S19. Compose with `uses`.** A nested object is mapped by its own mapper, which
is injected through `uses` and never reimplemented. Converters shared across
mappers, such as `DateMapper` or an identifier mapper, live in `shared.mapping`
and are referenced the same way.

**S20. Lookups through `@Context`.** A `@Context Map<K, V>` is the way to
resolve
a reference during mapping: the caller loads the data in one batched query (see
S49) and the mapper only reads the map. MapStruct passes the context down to
any helper method that declares it. Pass an empty map rather than `null`.

**S21. No Java expressions.** Avoid `expression = "java(...)"`, because the
compiler and the IDE's refactoring tools see it only as a string. Write a small
`protected` method instead, and MapStruct selects it by its source and target
types. Use `@Named` with `qualifiedByName` if two methods match the same types.
Don't make these helpers `private`: MapStruct silently ignores them and may fall
back to a built-in conversion, such as an enum's name.

**S22. Abstract classes with nullability proxies.** Mappers are abstract
classes,
not interfaces, which allows two levels of visibility:

- Each `public final` method states the nullability contract and delegates to
  the generated method. Generated methods return `null` for a `null` source, and
  the public signature makes that visible to callers and to NullAway.
- Each `protected abstract` method is what MapStruct implements, so only the
  generated class and the proxies call it.

A proxy carries a MapStruct qualifier that removes it from automatic selection.
Without it, a nested or collection mapping finds both the proxy and the
generated
method for the same types and fails with `Ambiguous mapping methods found`.
A method with several source arguments returns `null` only if all of them are
`null`, so give its arguments non-null types, as `toEntity` does below.

```java
@Qualifier
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.CLASS)
public @interface IgnoreMethodForMapping {}
```

**S23. Ignore explicitly.** Every target property that a mapping method doesn't
set is declared with `@Mapping(target = "...", ignore = true)`. Because unmapped
targets are compile errors (see B10), a new field fails the build until someone
decides how each method handles it.

These two mappers apply all of these rules:

```java
// persistence
@Mapper(uses = DateMapper.class)
abstract class ProjectEntityMapper {

    /*
     * Contract: the nullability is stated here, and these are the only methods
     * the repository calls.
     */

    @IgnoreMethodForMapping
    public final @Nullable Project toDomain(
        @Nullable ProjectEntity projectEntity) {

        return mapToDomain(projectEntity);
    }

    @IgnoreMethodForMapping
    public final ProjectEntity toEntity(Project project, String tenantId) {

        return mapToEntity(project, tenantId);
    }

    @IgnoreMethodForMapping
    public final void updateEntity(Project project,
        ProjectEntity projectEntity) {

        mapOntoEntity(project, projectEntity);
    }

    // MapStruct implements these. They are visible only to the generated class.

    protected abstract Project mapToDomain(ProjectEntity projectEntity);

    /*
     * tenantId matches the target property by name, so it needs no @Mapping.
     * tags is managed elsewhere, and the framework fills id, version and audit
     * (see S15 and S47), so this method declares that it doesn't set them.
     */
    @Mapping(target = "id", ignore = true)
    @Mapping(target = "version", ignore = true)
    @Mapping(target = "audit", ignore = true)
    @Mapping(target = "tags", ignore = true)
    protected abstract ProjectEntity mapToEntity(Project project,
        String tenantId);

    @Mapping(target = "id", ignore = true)
    @Mapping(target = "version", ignore = true)
    @Mapping(target = "audit", ignore = true)
    @Mapping(target = "tags", ignore = true)
    @Mapping(target = "tenantId", ignore = true)
    protected abstract void mapOntoEntity(Project project,
        @MappingTarget ProjectEntity projectEntity);

    /*
     * Rebuilds a persisted object through the factory that D5 requires,
     * including the read-only version and audit data.
     */
    @ObjectFactory
    protected Project rehydrate(ProjectEntity projectEntity) {

        return Project.rehydrate(projectEntity.getId(),
                                 projectEntity.getName(),
                                 projectEntity.getOwnerId(),
                                 projectEntity.getStatus(),
                                 projectEntity.getDescription(),
                                 projectEntity.getVersion(),
                                 AuditMapper.toDomain(projectEntity.getAudit()));
    }

}

// api
@Mapper(uses = DateMapper.class)
abstract class ProjectApiMapper {

    @IgnoreMethodForMapping
    public final @Nullable Project toDomain(
        @Nullable ProjectWriteDto projectWriteDto) {

        return mapToDomain(projectWriteDto);
    }

    @IgnoreMethodForMapping
    public final @Nullable ProjectReadDto toReadDto(@Nullable Project project,
        Map<Long, UserSummary> usersById) {

        return mapToReadDto(project, usersById);
    }

    protected abstract Project mapToDomain(ProjectWriteDto projectWriteDto);

    // Both helpers below are selected by their source and target types.
    @Mapping(target = "owner", source = "ownerId")
    @Mapping(target = "statusLabel", source = "status")
    protected abstract ProjectReadDto mapToReadDto(Project project,
        @Context Map<Long, UserSummary> usersById);

    // Lookup through @Context: no database access happens here.
    protected @Nullable OwnerDto toOwnerDto(Long ownerId,
        @Context Map<Long, UserSummary> usersById) {

        UserSummary userSummary = usersById.get(ownerId);

        return userSummary == null ? null : new OwnerDto(ownerId, userSummary.displayName());
    }

    // Replaces expression = "java(project.getStatus().name().toLowerCase())".
    protected String toStatusLabel(ProjectStatus status) {

        return status.name().toLowerCase();
    }

}
```

### Method naming

**S24. Fixed method names, enforced by ArchUnit.** `@Service` and `@Mapper`
classes use a fixed vocabulary, as J6 and the examples above show: `save`,
`update`, `delete` and `find*` for entity services, and `toDomain`, `toEntity`,
`toReadDto`, `toWriteDto`, `toFilter` and `updateEntity` for mappers. Enforce it
with ArchUnit rather than generic base interfaces such as `CrudService<T, ID>`.
Those interfaces pollute every signature with type parameters and force each
implementation to carry the same set of methods, while an ArchUnit test
constrains names and nothing else. Use cases (`*UseCase`, see S11) expose only
`handle`, and a new verb is added to the list deliberately.

```java
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
│   │   └── http/         Outbound HTTP clients, such as PayPalHttpClient (see S57)
│   ├── domain/           Project, ProjectFilter, value objects,
│   │                     state machines, domain events
│   ├── messaging/        Event publishers, consumers and callbacks
│   ├── persistence/      ProjectRepository, ProjectRepositoryImpl,
│   │                     ProjectJpaRepository, ProjectEntity,
│   │                     ProjectEntityMapper, ProjectPredicates
│   ├── scheduler/        Scheduled jobs
│   └── service/          ProjectService, ProjectServiceImpl, ProjectOnboardingService
└── shared/
    ├── audit/            AuditInfo, AuditEmbeddable, RequestAuditorAware
    ├── config/           Cross-cutting configuration
    ├── error/            Exception base types, global handler, error model
    ├── mapping/          Shared MapStruct converters, AuditMapper,
    │                     IgnoreMethodForMapping
    ├── openapi/          Composed OpenAPI annotations
    ├── pagination/       PageableDto, PageDto, SortOrderDto, PageMapper
    └── web/              Interceptors, request context, PatchApplier, ETags
```

Controllers that only read and controllers that also write are separate classes
in the same package, so they can share the package-private DTOs and mapper (see
S17).

### REST design

**S26. Richardson level 2.** REST APIs are built on resources, HTTP methods and
status codes, used as HTTP defines them.

**S27. Use the standard first.** If HTTP or an RFC already covers a feature, use
it instead of inventing a field, header or endpoint. Don't introduce custom
`X-` headers when a standard one exists.

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

| Avoid                       | Prefer                       |
| --------------------------- | ---------------------------- |
| `POST /getProjects`         | `GET /projects`              |
| `GET /deleteProject?id=42`  | `DELETE /projects/42`        |
| `POST /projects/42/archive` | `POST /projects/42/archival` |

**S29. Plural collection names.** A path segment that names a collection is
plural, and a single resource is addressed by its identifier inside that
collection. The same plural name serves both, so every resource follows one
pattern.

| Avoid                  | Prefer                   |
| ---------------------- | ------------------------ |
| `GET /project/42`      | `GET /projects/42`       |
| `GET /project/42/task` | `GET /projects/42/tasks` |

**S30. Path variables named after their resource.** A path variable is
named after the resource it identifies, never just `id`, so nested paths stay
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
  media type `application/merge-patch+json`. The client sends only the fields
  it changes, and `null` removes a field. It is the simplest format for clients
  and covers most resources.
- **JSON Patch when the resource needs it.** Use RFC 6902 with
  `application/json-patch+json` when Merge Patch can't express the change:
  editing single array elements, setting a field to `null` instead of removing
  it, or guarding a change with a `test` operation. A resource can accept both
  on the same path, routed by `consumes`.
- **Patch the write DTO, not the entity.** Clients can then reach only writable
  fields.
- **Validate after patching.** Spring validates the request body, which here is
  the patch document, so the patched DTO has to be validated explicitly.
- **Protect against lost updates.** The read and the update run in separate
  transactions (see S9), so require `If-Match` and pass the version down as in
  S8 (see D7).
- **Use the maintained artifact for JSON Patch.** Use
  `io.github.vishwakarma:zjsonpatch`, which is the project's current home and
  supports both Jackson generations through the same Java package: `JsonPatch`
  for Jackson 2 and `Jackson3JsonPatch` for Jackson 3. Its Jackson dependency is
  optional, so declare the one you use. The old
  `com.flipkart.zjsonpatch:zjsonpatch` artifact stopped at 0.4.16 in 2023.

```java
// Controller
@Override
public ResponseEntity<ProjectReadDto> mergePatch(Long projectId, String ifMatch,
    JsonNode mergePatch) {

    ProjectWriteDto current = projectApiMapper.toWriteDto(projectService.findById(projectId));
    ProjectWriteDto patched = patchApplier.applyMergePatch(mergePatch, current, ProjectWriteDto.class);
    Project updatedProject = projectService.update(projectId,
                                                   projectApiMapper.toDomain(patched),
                                                   ETags.toVersion(ifMatch));
    Map<Long, UserSummary> usersById = userService.findSummaries(Set.of(updatedProject.getOwnerId()));

    return ResponseEntity.ok()
                         .eTag(ETags.of(updatedProject.getVersion()))
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

        JsonNode patched = JsonPatch.apply(jsonPatch, objectMapper.valueToTree(source));

        return readAndValidate(patched, type);
    }

    public <T> T applyMergePatch(JsonNode mergePatch, T source, Class<T> type) {

        JsonNode patched = merge(objectMapper.valueToTree(source), mergePatch);

        return readAndValidate(patched, type);
    }

    // The merge algorithm defined in RFC 7396, section 2.
    private JsonNode merge(JsonNode target, JsonNode patch) {

        if (!patch.isObject()) {
            return patch;
        }

        ObjectNode result = target instanceof ObjectNode objectNode ? objectNode : objectMapper.createObjectNode();

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

        T result = read(patched, type);
        Set<ConstraintViolation<T>> violations = validator.validate(result);

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

**S34. DTOs validate shape, the domain validates rules.** Each rule lives in
one place.

- **DTOs** check what a request looks like: required fields, lengths, formats,
  ranges and patterns. A violation returns `400`. Use Jakarta Validation
  annotations, and create a custom annotation when the standard ones can't
  express the check. Use validation groups (`OnCreate`, `OnUpdate`) when rules
  differ by operation.
- **The domain** enforces business invariants, such as allowed state
  transitions or a uniqueness that depends on other data. A violation throws a
  coded domain error (see S41), usually returned as `409` or `422`.

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
reachable,
so it needs its own access control.

### Pagination

**S38. `Pageable` and `Page` start at the service.** Spring Data's types live in
the service layer and below. Controllers use `PageableDto` and `PageDto`, and
`PageMapper` converts between the two.

**S39. DTOs mirror Spring Data.** `PageableDto` and `PageDto` use the same field
names and types as `Pageable` and `Page`, with OpenAPI annotations added. The
API
contract then belongs to the project, because Spring Data doesn't guarantee a
stable JSON form for `Page`. The one difference is `sort`, since Spring's `Sort`
isn't a usable API type: a `SortOrderDto` mirrors `Sort.Order` with `property`
and
`direction`. Binding `sort=createdAt,DESC` from a query string needs a
registered
`Converter<String, SortOrderDto>`.

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
Page<Project> projects = projectService.findAll(pageMapper.toPageable(pageableDto));
Set<Long> ownerIds = projects.map(Project::getOwnerId).toSet();
Map<Long, UserSummary> usersById = userService.findSummaries(ownerIds);

return ResponseEntity.ok(pageMapper.toPageDto(projects.map(project -> projectApiMapper.toReadDto(project, usersById))));
```

`PageMapper` is hand-written, because MapStruct can't generate a mapping for a
generic type variable. Bound `pageSize` so a client can't request an entire
table.

### Error handling

**S40. One consistent error model.**

- All REST exceptions go through a single `@RestControllerAdvice` that extends
  `ResponseEntityExceptionHandler`, so Spring's own 4xx errors stay correct.
- The hierarchy is base exception → client (4xx) or server (5xx) → specific
  exception, and each exception owns its HTTP status.
- Every API returns the same error format, preferably `ProblemDetail` (RFC
  9457).
- Client errors log at `warn` without a stack trace. Server errors log at
  `error` with one.
- 5xx responses never expose internals such as bucket names, keys or parser
  messages.
- GraphQL needs its own exception resolver, because REST advice doesn't cover
  it.

**S41. Coded domain errors.** Alongside technical errors, document custom domain
errors with examples. Each has a stable, machine-readable code, such as
`PROJECT_ALREADY_ARCHIVED`, returned in the error body.

**S42. Useful messages, nothing technical.** Every error response, `4xx` and
`5xx` alike, carries a message the client can act on: what went wrong and, where
possible, how to fix it.

- Write the `detail` for the client. "Project 42 is archived and can't be
  renamed" helps. "Invalid state" doesn't.
- Never show anything technical: exception messages from libraries, class
  names, stack traces, SQL, constraint or column names, hostnames, file paths or
  bucket names. Never copy `exception.getMessage()` from a library exception into
  the response.
- Validation errors list each invalid field with its own message.
- A `5xx` response has a generic message plus the trace or correlation
  identifier, so support can find the full error in the logs.
- An error received from a remote system is translated into our own error
  model, never passed through to our client (see S57).

**S43. Bulk operations account for every entry.** A bulk operation either runs
in a single transaction, so it succeeds or fails as a whole, or reports each
entry. When it isn't one transaction:

- Each failed entry is processed independently, so one failure doesn't stop the
  others.
- Each failed entry is logged with its identifier and the reason it failed,
  following the levels in S40. Log identifiers, not whole payloads, so no
  personal data reaches the logs.
- The operation ends with one summary log line: processed, succeeded and
  failed.
- When the bulk operation is an API call, the response lists the outcome of
  each entry, with the same kind of useful message as S42.

This applies to scheduled jobs as well as to API calls (see S49 and D11).

### Persistence

**S44. Repositories hide the persistence technology.** A public
`ProjectRepository` interface speaks only in domain objects. A package-private
`ProjectRepositoryImpl` implements it by delegating to a package-private Spring
Data interface (`ProjectJpaRepository`), which never leaves the package. Spring
Data doesn't replace this layer, because it would expose entities.

**S45. Generated identifiers.** Identifiers are always generated automatically,
with the best strategy for the database:

| Database   | Strategy                                                      |
| ---------- | ------------------------------------------------------------- |
| PostgreSQL | `SEQUENCE`, with `allocationSize` to reduce round trips       |
| Oracle     | `SEQUENCE`, with `allocationSize` to reduce round trips       |
| MySQL      | `IDENTITY` (Hibernate can't batch inserts with this strategy) |
| MongoDB    | Generated `ObjectId`                                          |

**S46. UTC everywhere.** Dates are represented and stored in UTC. Use `Instant`
for moments in time, and keep `LocalDate` for true calendar dates.

```properties
spring.jackson.time-zone=UTC
spring.jpa.properties.hibernate.jdbc.time_zone=UTC
```

**S47. Automatic auditing.** Every persisted entity is audited by the
framework, never by hand.

- **One value object.** The four audit fields live in a single `@Embeddable`,
  `AuditEmbeddable`, that every entity embeds. It uses Spring Data's
  `@CreatedDate`, `@LastModifiedDate`, `@CreatedBy` and `@LastModifiedBy`. The
  last one is Spring's name for "updated by", so keep it.
- **Enabled once.** Turn auditing on with `@EnableJpaAuditing` in
  `shared.config`, and register `AuditingEntityListener` on every entity, or once
  for all of them in `orm.xml`. ArchUnit checks that every `@Entity` has an
  `AuditEmbeddable` field.
- **Read-only everywhere.** The audit fields have no setters (see S15). The
  entity mapper copies them into an `AuditInfo` record that the domain object
  carries read-only, like its identifier (see D5), and the API can expose them
  in the read DTO.
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

}

// Entity
@Entity
@EntityListeners(AuditingEntityListener.class)
class ProjectEntity {

    // ...

    @Version
    @Setter(AccessLevel.NONE)
    private long version;

    /*
     * Initialized here so the listener always has an instance to fill: Hibernate
     * leaves an embedded field null when all of its columns are null.
     */
    @Embedded
    @Setter(AccessLevel.NONE)
    private AuditEmbeddable audit = new AuditEmbeddable();

}
```

**S48. Field-level history with JaVers.** Automatic auditing records who
changed a resource and when, not what changed. When the history of individual
fields between versions is needed, use JaVers with its Spring Boot starter for
the data store.

- Audit through the Spring Data repository with `@JaversSpringDataAuditable`,
  so every save records a snapshot without extra code.
- JaVers' `AuthorProvider` uses the same source as `RequestAuditorAware`, so the
  audit columns and the change history always name the same author.
- Turn off JaVers' own schema management
  (`javers.sqlSchemaManagementEnabled=false`) and create its tables through
  changesets, like every other schema change (see S51).
- Expose the history through the API only through DTOs, like any other
  resource.

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
change it. It bypasses the persistence context, so `@Version` checks and
auditing
don't run, and the code has to account for that.

**S51. Versioned database changes.** Every schema change is versioned and
applied
by a migration library suited to the database. Prefer Liquibase over Flyway:
its changelogs describe changes in a vendor-neutral format that it translates
for each database, and it offers more flexibility, such as preconditions,
contexts and rollbacks. On
MongoDB, use `liquibase-mongodb`, or a dedicated tool such as Mongock if it fits
better. Never edit a changeset that has already been applied. Hibernate only
checks the schema and never changes it:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

**S52. Filters become predicates.** Domain filters are translated by the
specification framework of the data store (QueryDSL or JPA Specifications,
MongoDB `Criteria`) in a dedicated, package-private class such as
`ProjectPredicates`.

- It has one entry point that builds the full predicate from the filter.
- It chains one small private method per filter field.
- A field that is null or empty adds no condition.
- Shared conditions, such as date ranges, are reusable helpers.

**S53. QueryDSL with JPA.** Use QueryDSL when possible, because it keeps
predicate classes clear and type-safe. Add its annotation processor to the path
in [B10](#2-build-maven-and-gradle).

```java
@UtilityClass
class ProjectPredicates {

    static Predicate from(ProjectFilter filter) {

        return new BooleanBuilder().and(statusIn(filter.getStatuses()))
                                   .and(createdFrom(filter.getCreatedFrom()));
    }

    private static BooleanExpression statusIn(
        @Nullable Set<ProjectStatus> statuses) {

        return CollectionUtils.isEmpty(statuses) ? null : QProjectEntity.projectEntity.status.in(statuses);
    }

    private static BooleanExpression createdFrom(
        @Nullable Instant createdFrom) {

        return createdFrom == null ? null : QProjectEntity.projectEntity.createdAt.goe(createdFrom);
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
  use
  a shared cache such as Redis.
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

- **It speaks the domain.** Like a repository (see S44), the client is a public
  interface that takes and returns domain objects. Its implementation and the
  remote API's DTOs are package-private, so no external model leaks into the
  services.
- **Built on `RestClient`, configured the Spring Boot way.** Use `RestClient`,
  or an `@HttpExchange` interface backed by it, and configure it through
  properties and Spring Boot's builder customizers rather than by hand (see S5).
  The base URL, timeouts and credentials come from `@ConfigurationProperties`
  (see S4 and S60). With more than two operations, the interface is generated
  from the remote's OpenAPI specification (see S59).
- **Always set timeouts.** Connect and read timeouts are explicit for every
  client. A default of "wait forever" isn't acceptable.
- **Authentication through Spring.** OAuth2 client credentials go through
  Spring Security's OAuth2 client support, which obtains and refreshes the
  token. Never build an `Authorization` header by hand from a stored token.
- **Logging through Logbook.** Register Logbook's interceptor on the client, so
  outbound traffic follows the same rules as inbound traffic (see S55 and S56).
- **Errors become our errors.** A status handler translates remote errors into
  our exception hierarchy (see S40). The remote body is logged, never returned
  to our client (see S42).
- **Tested with WireMock** (see T6).

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
of a remote API that has an OpenAPI specification, the client is generated
with OpenAPI Generator rather than written by hand. For a public product, look
for its specification online first: the vendor's developer portal, its GitHub
organization, or the APIs.guru directory. For an internal service, use the
specification its build generates (see B8). With one or two operations, a
hand-written `@HttpExchange` interface is simpler than a generator setup.

- **The specification is committed** under `src/main/resources/openapi/`, so a
  vendor change arrives as a reviewed diff. The generated code isn't
  committed: the build generates it.
- **Spring HTTP interfaces.** Use the `spring` generator with the
  `spring-http-interface` library and
  `useHttpServiceProxyFactoryInterfacesConfigurator`, so the generated
  interfaces run on our configured `RestClient` (see S57).
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

**S60. Outbound URLs live in properties.** No URL is written in code. Each
remote system's protocol, host, version and endpoint paths are properties named
as S61 describes, composed with placeholders and bound with
`@ConfigurationProperties` (see S4). A remote with many endpoints gets its own
file, such as `paypal-api.properties`, loaded with `@PropertySource` the way
`api-paths.properties` is (see S62), so `application.properties` stays
readable. Values that change per environment come from environment variables.

```properties
### PAYPAL ###
paypal.api.protocol=https
paypal.api.host=${PAYPAL_API_HOST:api-m.sandbox.paypal.com}
paypal.api.version=v2
paypal.api.base-url=${paypal.api.protocol}://${paypal.api.host}/${paypal.api.version}
paypal.api.payments.path=/payments
paypal.api.payments.id.path=${paypal.api.payments.path}/{paymentId}
paypal.api.connect-timeout=2s
paypal.api.read-timeout=5s
```

```java
@Configuration
@PropertySource("classpath:paypal-api.properties")
@EnableConfigurationProperties(PayPalApiProperties.class)
class PayPalHttpClientConfig {
    // Loads PayPal's endpoints and binds them to PayPalApiProperties.
}

@ConfigurationProperties("paypal.api")
record PayPalApiProperties(String baseUrl, Duration connectTimeout, Duration readTimeout) {}
```

### Configuration files

**S61. Hierarchical property keys.** A property key is a dot-separated path
from the most general segment to the most specific one: the owner (one of our
features, or a remote system), then the area, then the detail, such as
`paypal.api.payments.path` or `scheduler.order.cleanup.lock-at-most`. Each
segment is lower-case kebab-case. A value used by several keys is defined once
and referenced with `${…}`, so a base path or a host changes in one place, and
keys under one prefix bind to one `@ConfigurationProperties` record (see S4).
Related keys sit together under a comment heading, such as `### PAYPAL ###`.

**S62. Endpoint paths live in `api-paths.properties`.** Every controller path
is a key in `src/main/resources/api-paths.properties`, loaded by one
`@PropertySource` configuration class, and each mapping annotation references
its key as a single placeholder: no literal paths and no class-level prefix.
The file lists the whole API surface in one place, the version prefix composes
from one base path, and S28 to S30 apply to the resolved paths.

```properties
api.v1.version=v1
api.v1.base-path=/api/${api.v1.version}
### PROJECTS ###
api.v1.projects.path=${api.v1.base-path}/projects
api.v1.projects.id.path=${api.v1.projects.path}/{projectId}
api.v1.projects.id.tasks.path=${api.v1.projects.id.path}/tasks
```

```java
@Configuration
@PropertySource("classpath:api-paths.properties")
class ApiPathsConfig {
    // Loads the controller paths that the mappings reference as ${…} placeholders.
}

@GetMapping("${api.v1.projects.id.path}")
ResponseEntity<ProjectReadDto> findById(@PathVariable UUID projectId);
```

## 4. Domain-Driven and Event-Driven Design

### Domain objects

**D1. Plain Java.** Domain classes have no framework leakage: no Spring, JPA,
Jackson or Bean Validation. Two compile-time aids are allowed because they add
no runtime behavior: Lombok and nullability annotations.

**D2. Coherent from construction.** A public constructor takes the minimum set
of mandatory fields that makes the object coherent. Other fields get default
values where that makes sense, and setters fill in the rest.

**D3. Behavior protects invariants.** Setters are for free-form optional values.
State with rules attached, such as a status, changes only through behavior
methods like `archive()`.

**D4. Step builders for many mandatory fields.** When an object has many
mandatory values, a constructor stops being readable. Prefer the Step Builder
pattern (also called the Staged or Typesafe Builder), which makes the compiler
reject a missing mandatory field. Lombok's `@Builder` can't do this, so write it
by hand or generate it with a tool such as Jilt.

**D5. Domain objects don't create identifiers or technical data.** An
identifier, a version and audit data appear only after the object has been
mapped back from the persistence layer, and they are read-only. A new object has
none of them. A service update receives the ID as a separate argument, because
the object carrying the changes is new (see S8). Mappers rebuild persisted
objects through a single, clearly named factory, whose use ArchUnit restricts to
mappers.

```java
@Getter
public class Project {

    private @Nullable Long id;

    private String name;

    private final Long ownerId;

    private ProjectStatus status = ProjectStatus.DRAFT;

    @Setter
    private @Nullable String description;

    private @Nullable Long version;

    private @Nullable AuditInfo audit;

    public Project(String name, Long ownerId) {

        this.name = Objects.requireNonNull(name);
        this.ownerId = Objects.requireNonNull(ownerId);
    }

    public static Project rehydrate(Long id,
        String name,
        Long ownerId,
        ProjectStatus status,
        @Nullable String description,
        Long version,
        AuditInfo audit) {

        Project project = new Project(name, ownerId);
        project.id = id;
        project.status = status;
        project.description = description;
        project.version = version;
        project.audit = audit;

        return project;
    }

    public void rename(String name) {

        this.name = Objects.requireNonNull(name);
    }

    public void archive() {

        status = status.transitionTo(ProjectStatus.ARCHIVED);
    }

}
```

**D6. Explicit state machines.** Lifecycles are explicit state machines with
validated transitions.

**D7. Optimistic locking.** Concurrent writes use optimistic locking, and the
code handles the conflict. Over REST, the version travels as `ETag` and
`If-Match` (see S8).

### Events and background work

**D8. Transactional outbox across systems.** Whenever a change in our database
must go together with an effect on another system, such as publishing an event,
sending a message or calling another service, use the transactional outbox
pattern. The change and an outbox record are written in the same local
transaction, and a separate relay delivers the record afterwards, retrying until
it succeeds. Never write to the database and then publish or call in sequence,
and never use distributed transactions (XA or two-phase commit). Spring
Modulith's event publication registry is an outbox; use it when the project
already uses Modulith. The receiving side must be idempotent (see D9), because
the relay can deliver a record more than once.

**D9. Idempotent consumers.** Consumers tolerate duplicates. Discarded events
are stored and can be recovered.

**D10. Versioned schemas.** Event schemas are versioned and live in the
repository.

**D11. Safe scheduled jobs.** Scheduled jobs in a cluster use a distributed
lock, and each job has its own on/off switch.

### Value grouping

**D12. Group what belongs together.** Values that form one concept in the
domain are one type wherever they're modelled: a value object in the domain, a
nested DTO in the API, an `@Embeddable` in a JPA entity and an embedded
document in MongoDB. An address is an `Address`, never `addressStreet`,
`addressCity` and `addressZipCode` side by side. The group carries its own
validation and behavior, and each layer maps it with one mapper method.
`AuditEmbeddable` (see S47) is one such group.

The grouping lives in the object model only. In the database the group stays
columns of the owning table, which is how `@Embeddable` maps it, and raw SQL
persistence (Spring Data JDBC, jOOQ, hand-written SQL) isn't modelled this
way, because a table per group costs a join on every read.

```java
@Entity
class CustomerEntity {

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

}
```

## 5. Testing

**T1. Test every branch.** All code branches are tested.

**T2. Readable tests.** Name test classes `<Subject>Test` (not `*Tests` or
`*IT`), name tests `shouldXWhenY`, group them with `@Nested` and `@DisplayName`,
and assert with AssertJ.

**T3. Parameterize.** When several tests share the same logic and differ only in
their data, write one parameterized test instead.

**T4. Unit tests.** Unit tests cover domain and service logic.

**T5. Slice tests for controllers.** Test controllers with `@WebMvcTest` or the
GraphQL tester, so routing, validation, JSON and error mapping are all
exercised.

**T6. Slice tests for integrations.** Repositories with custom queries are
tested with the data store's slice test, such as `@DataJpaTest`. Outbound HTTP
clients are tested against WireMock, including timeouts and remote errors.

**T7. No shortcuts.** Never mock value objects or DTOs, and never set fields by
reflection.
