---
name: spring-boot-architecture
description: 'Use when designing or changing Spring Boot application services, controllers, configuration or package layout in a project that follows the java-standards opt-in. Covers Lombok, logging, constructor injection, typed configuration, public ports with package-private implementations, aggregates for writes and read models for reads, the update flow with ETag and If-Match, one application service per use case (a verb-first port, a self-validating *Command with a step builder, a package-private *Service with a single execute), services that orchestrate while the domain decides, package by feature with hexagonal adapter packages, hierarchical property keys and controller paths in api-paths.properties (rules S1 to S12, S25, S61 and S62).'
paths: '**/*.java, **/pom.xml, **/build.gradle*'
---

<!-- Generated from standards/java-standards.md by scripts/build-skills.js. -->
<!-- markdownlint-disable MD013 -->

# Spring Boot architecture

Before applying this skill, read `.claude/java-standards.json` at the
repository root. If it doesn't exist, or the file you're working on is
outside its `include`/`exclude` scope, follow the conventions of the
surrounding code instead.

Break a rule only with a concrete reason, and write that reason down. At
Stop, the java plugin blocks on violations in lines you changed; mark a
justified exception with `// java-rules:allow <ID> <reason>`.

## Foundations

**S1. Lombok everywhere it helps.** Use it wherever it removes boilerplate, with
the type-specific rules in Models.

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
- Repositories follow the same pattern (see S44).

## Layers and flow

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
(see Pagination). They never appear inside domain classes.

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

## Services

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

## Package structure

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

## Configuration files

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
