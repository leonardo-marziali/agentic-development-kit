---
name: mapstruct-mapping
description: 'Use when creating DTOs, domain objects, entities or MapStruct mappers in a project that follows the java-standards opt-in. Covers the model set, DTO and entity Lombok style, one mapper per layer boundary, @Context lookups, no java() expressions, abstract mappers with nullability proxies, explicit ignores, the fixed method vocabulary and grouping related values into one type (rules S13 to S24 and D12).'
paths: '**/*.java, **/pom.xml, **/build.gradle*'
---

<!-- Generated from standards/java-standards.md by scripts/build-skills.js. -->
<!-- markdownlint-disable MD013 -->

# Models and MapStruct mapping

Before applying this skill, read `.claude/java-standards.json` at the
repository root. If it doesn't exist, or the file you're working on is
outside its `include`/`exclude` scope, follow the conventions of the
surrounding code instead.

Break a rule only with a concrete reason, and write that reason down. At
Stop, the java plugin blocks on violations in lines you changed; mark a
justified exception with `// java-rules:allow <ID> <reason>`.

## Models

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

## Mapping

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

## Method naming

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
