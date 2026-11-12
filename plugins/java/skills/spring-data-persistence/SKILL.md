---
name: spring-data-persistence
description: 'Use when writing repositories, entities, queries, auditing, migrations or filters with Spring Data JPA or MongoDB in a project that follows the java-standards opt-in. Covers repositories that hide the store, generated ids, UTC times, automatic auditing, JaVers, avoiding N+1 queries, query preference order, Liquibase, QueryDSL predicate classes and @Embeddable value groups (rules S44 to S53 and D12).'
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
in B10.

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

## Value grouping

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
