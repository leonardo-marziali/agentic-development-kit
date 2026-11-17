---
name: spring-data-persistence
description: 'Use when writing repositories, query services, entities, queries, auditing, migrations or filters with Spring Data JPA, JDBC or MongoDB in a project that follows the java-standards opt-in. Covers repositories as driven ports that hide the store, identifiers allocated by the repository, UTC times, automatic auditing kept out of the domain, JaVers, avoiding N+1 queries, query preference order, Liquibase, QueryDSL predicate classes, immutable value objects and @Embeddable value groups (rules S44 to S53, D22 and D23).'
paths: '**/*.java, **/pom.xml, **/build.gradle*'
---

<!-- Generated from standards/java-standards.md by scripts/build-skills.js. -->
<!-- markdownlint-disable MD013 -->

# Persistence with Spring Data

Before applying this skill, read `.claude/java-standards.json` at the
repository root. If it doesn't exist, or the file you're working on is
outside its `include`/`exclude` scope, follow the conventions of the
surrounding code instead.

Break a rule only with a concrete reason, and write that reason down. At
Stop, the java plugin blocks on violations in lines you changed; mark a
justified exception with `// java-rules:allow <ID> <reason>`.

## Persistence

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
- **Cache slow-changing data:** see Caching.
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
in B10.

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

## Value objects

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
