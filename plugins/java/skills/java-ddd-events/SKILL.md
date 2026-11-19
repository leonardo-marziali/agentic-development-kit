---
name: java-ddd-events
description: 'Use when modelling bounded contexts, aggregates, value objects, domain services, ports and adapters, state machines, events, messaging or scheduled jobs in a project that follows the java-standards opt-in. Covers the ubiquitous language, bounded contexts and anti-corruption layers, Spring Modulith named interfaces and an open shared module, the hexagonal core with driving and driven ports enforced by ArchUnit, adapters named after their technology and port, aggregate boundaries, references by identity, one aggregate per transaction, optimistic locking on the root, read models that bypass the aggregate, plain-Java domain classes, creation factories, step builders, early identity and reconstitution, explicit state machines, value objects, domain events and integration events published from an events package, the transactional outbox, idempotent consumers, versioned schemas and safe scheduled jobs (rules D1 to D29).'
paths: '**/*.java, **/pom.xml, **/build.gradle*'
---

<!-- Generated from standards/java-standards.md by scripts/build-skills.js. -->
<!-- markdownlint-disable MD013 -->

# Domain-driven, hexagonal and event-driven design

Before applying this skill, read `.claude/java-standards.json` at the
repository root. If it doesn't exist, or the file you're working on is
outside its `include`/`exclude` scope, follow the conventions of the
surrounding code instead.

Break a rule only with a concrete reason, and write that reason down. At
Stop, the java plugin blocks on violations in lines you changed; mark a
justified exception with `// java-rules:allow <ID> <reason>`.

## Domain-Driven, Hexagonal and Event-Driven Design

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
  and needs no Spring context, so it runs with the unit tests (see T4).
- **Publish the API on purpose.** Modulith treats a module's base package as
  its API and every sub-package as internal, so a feature's API is declared
  with `@NamedInterface` on the `package-info.java` of two kinds of package,
  and of nothing else:
  - `application`, with the driving ports, their commands, read models and
    filters (see S7), and each per-action subpackage of S10 under its own
    name. Implementations are package-private (see S6), so the named interface
    exposes only contracts.
  - `events`, the integration events other modules listen to (see D25).

  `domain` is never exposed (see D10), and neither is any adapter package.

- **`shared` is an open module.** `shared` is a top-level package too, so
  Modulith treats it as a module, and its sub-packages would be internal.
  Declare it `Type.OPEN`, so every feature can use `shared.domain`,
  `shared.application`, `shared.web` and the rest. It never depends on a
  feature: that dependency would form a cycle, which the verification rejects.

```java
// shared/package-info.java
@ApplicationModule(type = ApplicationModule.Type.OPEN)
@NullMarked
package com.company.app.shared;

import org.jspecify.annotations.NullMarked;
import org.springframework.modulith.ApplicationModule;

// project/application/package-info.java
@NamedInterface("application")
@NullMarked
package com.company.app.project.application;

import org.jspecify.annotations.NullMarked;
import org.springframework.modulith.NamedInterface;

// project/events/package-info.java
@NamedInterface("events")
@NullMarked
package com.company.app.project.events;

import org.jspecify.annotations.NullMarked;
import org.springframework.modulith.NamedInterface;
```

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
   │ messaging.in         │──┐           ┌─▶│  JpaProjectRepository     │
   │ scheduler (jobs)     │  │           │  │  JpaProjectQueries        │
   └──────────────────────┘  │           │  │ client.http               │
                             │           │  │  PayPalPaymentGateway     │
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
  wants done, so `PaymentGateway` and never `PayPalClient`.
- **Name the adapter by what it's built on.** An implementation of a driven
  port, or of a query port in `persistence`, is the port's name with the
  technology or the remote system in front: `JpaProjectRepository implements
ProjectRepository`, `JpaProjectQueries implements ProjectQueries`,
  `PayPalPaymentGateway implements PaymentGateway`. The package already names
  the kind of adapter (`persistence`, `client.http`), so the name adds only
  what the package can't say. Two names stay outside the pattern:
  - **Application services** are `<Port>Service` (see S10).
  - **An implementation in the core** has no technology to name, so it's
    `Default<Port>`, the convention Spring itself uses
    (`DefaultConversionService`), as in D14.

  The `Impl` suffix is left to generated code, MapStruct's `*MapperImpl`, so a
  name ending in `Impl` always means "generated" (see S17). The Spring Data
  interface behind a repository is named after what it stores,
  `ProjectEntityRepository`, so it can't be mistaken for the adapter.

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
// ProjectEntityRepository: Spring Data ignores "Locked", between "find" and "By"
@Lock(LockModeType.OPTIMISTIC_FORCE_INCREMENT)
Optional<ProjectEntity> findLockedById(Long id);

// JpaProjectRepository
@Override
public Project getByIdForUpdate(ProjectId projectId) {

    return projectEntityRepository.findLockedById(projectId.value())
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
- **The implementation.** `JpaProjectQueries` lives in `persistence`,
  package-private, and reads the entities, a projection or plain SQL directly.
  Implementing a driving port in an adapter is a deliberate shortcut: it saves a
  query service in the core whose only job would be to call a driven port. When
  a read needs business logic, such as a computed balance, write
  `DefaultProjectQueries` in `application` instead, annotated `@Component`
  rather than `@Service` (see S12), and give it a driven port. It has no
  technology to name, so it takes the `Default` prefix (see D6).
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
// Jackson 3 lives in tools.jackson, but its annotations stay in com.fasterxml (see Baseline).
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
Optional values that no other rule depends on may have setters (see D17).
Nothing else does.

**D17. Behavior protects invariants.** State with rules attached, such as a
status, changes only through behavior methods named in the ubiquitous language,
such as `archive()` rather than `setStatus(ARCHIVED)`. The method checks the
rule, changes the state and records the domain event in one place. Callers tell
the aggregate what to do; they don't read its state, decide, and write it back.
Setters are kept for optional values that no other rule depends on, such as a
description. A value with a rule of its own, such as a length, still gets a
setter, as long as its type is a value object that enforces that rule (see
D22): the setter then can't take an invalid value.

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

    private final ProjectId id;

    // Its limits live on the value object, which the commands and DTOs reference (see D22).
    private ProjectName name;

    // A user of another module, referenced by its plain identifier (see D10).
    private final long ownerId;

    private ProjectStatus status = ProjectStatus.DRAFT;

    // No other rule depends on it, so a setter will do: the type carries its limit.
    @Setter
    private @Nullable ProjectDescription description;

    // Null until the aggregate is first stored. Only reconstitute sets it.
    private @Nullable Long version;

    private Project(ProjectId id, ProjectName name, long ownerId) {

        this.id = Objects.requireNonNull(id);
        this.name = Objects.requireNonNull(name);
        this.ownerId = ownerId;
    }

    // Creation: a new project, with its rules and its event.
    public static Project draft(ProjectId id, ProjectName name, long ownerId, Instant draftedAt) {

        final Project project = new Project(id, name, ownerId);
        project.registerEvent(new ProjectDrafted(project.newEventId(), id, ownerId, draftedAt));

        return project;
    }

    // Reconstitution: a stored project, with no rules and no events.
    public static Project reconstitute(ProjectId id,
        ProjectName name,
        long ownerId,
        ProjectStatus status,
        @Nullable ProjectDescription description,
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

    public void rename(ProjectName name) {

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
                                              new ProjectName(command.name()),
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
  validation or behavior. A limit is a rule, so a project's name and its
  description, both limited in length, are `ProjectName` and
  `ProjectDescription`. A `String` with no rule at all, such as an unbounded
  note, stays a `String`.
- **The value object owns its limits.** A limit is a constant on the value
  object that enforces it, such as `ProjectName.MAX_LENGTH`, and nowhere else
  (see J21). DTOs and commands reference that constant, so a request learns
  about every invalid field at once (see S34), but the value object stays the
  authority: no adapter, command or future use case can put an invalid name
  into a `Project`.
- **Commands carry plain values; services build the value objects.** A command
  holds the `String` and checks it against the value object's constant, and the
  application service creates the value object before calling the aggregate
  (see S8). Identifiers are the exception: the controller types them on arrival
  (see S8), because an invalid identifier is a bad address, not a form field to
  report alongside others.
- **Tighten a limit with a migration first.** Reconstitution goes through the
  value objects too, so a stored value that breaks a tightened limit fails to
  load (see D19). Correct the stored data in a migration before the release that
  tightens the limit (see S51).
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
  the feature, while hand-written code calls the constructor and `value()`
  directly (see S19).

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
public record ProjectName(String value) {

    public static final int MAX_LENGTH = 120;

    public ProjectName {

        Objects.requireNonNull(value);

        if (value.isBlank() || value.length() > MAX_LENGTH) {
            // An InvalidValueException: PROJECT_NAME_INVALID, answered with 400 (see S40).
            throw new InvalidProjectNameException(MAX_LENGTH);
        }
    }

}

public record ProjectDescription(String value) {

    public static final int MAX_LENGTH = 2000;

    public ProjectDescription {

        Objects.requireNonNull(value);

        if (value.length() > MAX_LENGTH) {
            throw new InvalidProjectDescriptionException(MAX_LENGTH);
        }
    }

    // The description is optional: no text, no value object.
    public static @Nullable ProjectDescription ofNullable(@Nullable String value) {

        return value == null ? null : new ProjectDescription(value);
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
- **Reacting inside the module.** Another aggregate of the same module reacts
  in its own transaction (see D11), through a listener in `messaging.in` that
  calls an application service, like any driving adapter (see D5). Use Spring
  Modulith's `@ApplicationModuleListener`, which runs after commit, in a new
  transaction, through the event publication registry (see D26).
- **Reacting across modules.** Another module never listens to a domain event,
  because it would depend on our `domain` package (see D10). It listens to the
  integration event that `messaging.out` translates from it (see D25), with the
  same `@ApplicationModuleListener`.
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
            throw new VersionMismatchException(getClass().getSimpleName(), expectedVersion);
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
event describes our model and may change whenever the model does. Other modules,
bounded contexts and systems never receive it directly. They receive an
integration event: a separate record in the feature's `events` package, named
`<DomainEvent>IntegrationEvent`, designed as part of our published language,
versioned (see D28) and holding only plain values, so no typed identifier
crosses the module (see D10).

- **Publish deliberately.** Only events another module or context needs become
  integration events. Most domain events stay internal.
- **Translated once, in the transaction.** A package-private translator in
  `messaging.out` listens to the domain event with a plain `@EventListener`,
  maps it and publishes the integration event. A plain listener runs inside the
  transaction that changed the aggregate (see D24), which is right here: the
  integration event enters the publication registry together with the change,
  and the translator only maps, so nothing else happens in that transaction.
  Listeners in other modules and the externalization (see D26) receive the
  same integration event, so the mapping has one home (see J21).
- **Choose the payload on purpose.** An event notification carries identifiers
  and the consumer queries for the rest. Use it when the consumer needs the
  latest state or the data is sensitive. Event-carried state transfer carries
  the changed state, so the consumer can keep a local copy and keep working when
  we're down. Use it when the consumer can accept eventually consistent data.
- **No entity dumps.** An integration event never serializes an entity or an
  aggregate as it is, because that turns our internal model into someone else's
  contract.

```java
// project.events: the contract, with the envelope of D28
public record ProjectArchivedIntegrationEvent(UUID eventId,
    long projectId,
    Instant occurredAt,
    int schemaVersion) {

    public static final int SCHEMA_VERSION = 1;

}

// project.messaging.out
@Component
@RequiredArgsConstructor
class ProjectIntegrationEventTranslator {

    private final ApplicationEventPublisher eventPublisher;

    // Runs in the transaction that archived the project, so both commit together.
    @EventListener
    void on(ProjectArchived projectArchived) {

        eventPublisher.publishEvent(new ProjectArchivedIntegrationEvent(projectArchived.eventId(),
                                                                        projectArchived.projectId().value(),
                                                                        projectArchived.occurredAt(),
                                                                        ProjectArchivedIntegrationEvent.SCHEMA_VERSION));
    }

}

// billing.messaging.in: depends only on the project module's "events" interface
@Component
@RequiredArgsConstructor
class ProjectEventsListener {

    private final CloseProjectBilling closeProjectBilling;

    // The service deduplicates on the event identifier (see D27).
    @ApplicationModuleListener
    void on(ProjectArchivedIntegrationEvent event) {

        closeProjectBilling.execute(CloseProjectBillingCommand.builder()
            .projectId(event.projectId())
            .eventId(event.eventId())
            .build());
    }

}
```

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
`EventExternalizationConfiguration`, selecting the integration events that the
translator has already mapped (see D25), rather than annotating them with
`@Externalized`: the routing to topics is adapter configuration, and the
contract in `events` stays free of it. The receiving side must be idempotent
(see D27), because the relay can deliver a record more than once.

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
  is the domain event's `eventId` (see D24), copied by the translator (see
  D25), never a new one: consumers deduplicate on it (see D27).
- Changes are backward compatible: add optional fields, never rename, remove or
  change the meaning of one. A breaking change is a new version, published next
  to the old one until every consumer has moved.
- The build checks the schema against the committed file, like the OpenAPI
  contract (see B8).

### Background work

**D29. Safe scheduled jobs.** Scheduled jobs are driving adapters in
`scheduler`: they call an application service and contain no business logic.
The one exception is upkeep with no business rule at all, such as resubmitting
event publications (see D26): that job lives in `shared` and calls Spring
Modulith directly. In
a cluster, they use a distributed lock, such as ShedLock, and each job has its
own on/off switch in configuration. A job whose action takes input builds the
command like any other adapter, so the command validates itself (see S34), and a
command the job can't build is a bug in the job, logged at `error`. An action
without input, such as a cleanup that only needs the current time from the
injected `Clock`, has `execute()` and no command (see S11).
