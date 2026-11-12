---
name: java-ddd-events
description: 'Use when modelling domain objects, state machines, events, messaging or scheduled jobs in a project that follows the java-standards opt-in. Covers plain-Java domain classes, construction and invariants, step builders, rehydration, explicit state machines, optimistic locking, the transactional outbox, idempotent consumers, versioned schemas and safe scheduled jobs (rules D1 to D11).'
paths: '**/*.java, **/pom.xml, **/build.gradle*'
---

<!-- Generated from standards/java-standards.md by scripts/build-skills.js. -->
<!-- markdownlint-disable MD013 -->

# Domain-driven and event-driven design

Before applying this skill, read `.claude/java-standards.json` at the
repository root. If it doesn't exist, or the file you're working on is
outside its `include`/`exclude` scope, follow the conventions of the
surrounding code instead.

Break a rule only with a concrete reason, and write that reason down. At
Stop, the java plugin blocks on violations in lines you changed; mark a
justified exception with `// java-rules:allow <ID> <reason>`.

## Domain-Driven and Event-Driven Design

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
