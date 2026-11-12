---
name: spring-boot-architecture
description: 'Use when designing or changing Spring Boot services, controllers, configuration or package layout in a project that follows the java-standards opt-in. Covers Lombok, logging, constructor injection, typed configuration, visibility of managed classes, how domain objects cross the layers, the update flow with ETag and If-Match, entity versus use case services, use cases taking one builder-built *Command, package by feature, hierarchical property keys and controller paths in api-paths.properties (rules S1 to S12, S25, S61 and S62).'
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
- Services expose a public interface, with a package-private implementation in
  the same package.
- Internal collaborators are package-private classes with no interface.
  Interfaces exist only at package boundaries.
- Repositories follow the same pattern (see S44).

## Layers and flow

**S7. Domain objects cross the layers.** The public interfaces of services and
repositories expose only domain objects, as input and output. DTOs stop at the
controller and entities stop at the repository. Spring Data's `Pageable` and
`Page` are the one accepted exception on these interfaces (see
Pagination). They never appear inside domain classes.

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

## Services

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

## Configuration files

**S61. Hierarchical property keys.** A property key is a dot-separated path
from the most general segment to the most specific one: the owner (one of our
features, or a remote system), then the area, then the detail, such as
`paypal.api.payments.path` or `scheduler.order.cleanup.lock-at-most`. Each
segment is lower-case kebab-case. A value used by several keys is defined once
and referenced with `${…}`, so a base path or a host changes in one place, and
keys under one prefix bind to one `@ConfigurationProperties` record (see S4).
Related keys sit together under a comment heading, such as `### PAYPAL ###`.

**S62. Endpoint paths live in properties files.** Every controller path is a
key in a properties file under `src/main/resources`, loaded by one
`@PropertySource` configuration class, and each mapping annotation references
its key as a single placeholder: no literal paths and no class-level prefix.
Public and internal APIs are kept apart:

- **Public paths** go in `api-paths.properties`, under `api.`. That file lists
  the whole public contract in one place, and S28 to S30 apply to the
  resolved paths.
- **Internal paths**, such as event callbacks and cluster HTTP RPCs (the
  `@Hidden` endpoints of S37), go in `internal-api-paths.properties`, under
  `internal.api.`. They may use verbs, but they're still listed in one place,
  so the internal surface is reviewed and secured as a whole.

The version prefix composes from one base path, which both files share.

```properties
api.v1.version=v1
api.v1.base-path=/api/${api.v1.version}
### PROJECTS ###
api.v1.projects.path=${api.v1.base-path}/projects
api.v1.projects.id.path=${api.v1.projects.path}/{projectId}
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
ResponseEntity<ProjectReadDto> findById(@PathVariable UUID projectId);

@Hidden
@PostMapping("${internal.api.v1.callbacks.order-paid.path}")
ResponseEntity<Void> onOrderPaid(@RequestBody OrderPaidEventDto event);
```
