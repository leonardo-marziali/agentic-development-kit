---
name: mapstruct-mapping
description: 'Use when creating DTOs, commands, read models, domain objects, entities or MapStruct mappers in a project that follows the java-standards opt-in. Covers the model set, record read DTOs and anemic entity style, one mapper per layer boundary, @Context lookups, no java() expressions, converters that serve MapStruct only, abstract mappers with nullability proxies, explicit ignores, the fixed method vocabulary of repositories, query services and mappers, immutable value objects and grouping related values into one type (rules S13 to S24, D22 and D23).'
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

**S13. The model set.** A domain concept gets one model per role it plays, and
only the roles it needs. For `Project`:

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

The table lists kinds of model, not a fixed count. Every other action has its
own command (see S11), a state change can have its own write DTO, such as
`ProjectStatusDto` (see S28), integration events are types of their own (see
D25), and shared values such as `AuditInfo` appear in several models (see S47).

**S14. DTO style.** Read DTOs are immutable records with Lombok's `@Builder`,
like every other immutable value carrier (see J15). Code that builds one by hand
uses the builder, because it names every value at the call site; MapStruct finds
the same builder (see S11). Write and filter DTOs use `@Data`. DTOs prefer
composition over inheritance.

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

    private String name;

    private long ownerId;

    @Enumerated(EnumType.STRING)
    private ProjectStatus status;

    private @Nullable String description;

    @Setter(AccessLevel.NONE)
    private String tenantId;

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

## Mapping

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
- `persistence` holds `JpaProjectRepository`, `JpaProjectQueries`,
  `ProjectEntityRepository`, `ProjectEntity`, `ProjectEntityMapper` and
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
    .haveSimpleNameNotEndingWith("MapperImpl")
    .should().dependOnClassesThat()
    .haveSimpleNameEndingWith("MapperImpl")
    .because("inject the abstract mapper; MapStruct owns the implementation");
```

The generated implementations are exempt by name. MapStruct marks them with
`javax.annotation.processing.Generated`, but that annotation has source
retention, so it isn't in the bytecode ArchUnit reads. A hand-written class that
extends a generated implementation is still caught, which is the point. Mapper
tests construct the implementation directly (see T4), and they're outside the
import (see B7).

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
they all reference the same way:

- **One feature's value objects** have their converter in the feature's
  `mapping` package, such as `project.mapping.ProjectIdMapper`, used by
  `ProjectApiMapper` and `ProjectEntityMapper`.
- **Values shared across features**, such as dates, have theirs in
  `shared.mapping`, such as `DateMapper`.

Converters are hand-written Spring beans, so MapStruct injects them like any
other mapper. Their public methods follow the mapper vocabulary of S24.

- **The rule's home is the value object.** What makes an identifier valid lives
  in `ProjectId`'s constructor and nowhere else (see D22 and J21). A converter
  holds no rule: it only lets generated code reach the constructor, and passes
  through the `null` that MapStruct hands over for an absent value.
- **Hand-written code calls the value object directly.** A controller types an
  identifier with `new ProjectId(projectId)` (see S8), a repository unwraps it
  with `value()` (see S44), and the mapper's object factory builds it for
  `reconstitute` (see S23). None of them goes through a converter, which exists
  for MapStruct only and accepts a `null` that hand-written code never has.
  ArchUnit keeps it that way:

```java
@ArchTest
static final ArchRule convertersServeMapStructOnly = noClasses().that()
    .resideOutsideOfPackage("..mapping..")
    .and().areNotAnnotatedWith(Mapper.class)
    .and().haveSimpleNameNotEndingWith("MapperImpl")
    .should().dependOnClassesThat().resideInAPackage("..mapping..")
    .because("hand-written code converts through the value object itself");
```

```java
// project.mapping. For MapStruct only: the rule is ProjectId's constructor.
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

    // reconstitute below builds the whole aggregate, so the setter isn't a target.
    @Mapping(target = "description", ignore = true)
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
                                    new ProjectName(projectEntity.getName()),
                                    projectEntity.getOwnerId(),
                                    projectEntity.getStatus(),
                                    ProjectDescription.ofNullable(projectEntity.getDescription()),
                                    Objects.requireNonNull(projectEntity.getVersion(), "a stored project has a version"));
    }

    // Value objects to columns, selected by their source and target types (see S21).
    protected String toNameColumn(ProjectName projectName) {

        return projectName.value();
    }

    protected @Nullable String toDescriptionColumn(@Nullable ProjectDescription projectDescription) {

        return projectDescription == null ? null : projectDescription.value();
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

        return userSummary == null ? null : OwnerDto.builder()
                                                    .id(ownerId)
                                                    .displayName(userSummary.displayName())
                                                    .build();
    }

    // Replaces expression = "java(project.status().name().toLowerCase())".
    protected String toStatusLabel(ProjectStatus status) {

        return status.name().toLowerCase();
    }

}
```

## Method naming

**S24. Fixed method names, enforced by ArchUnit.** Repositories, query services
and mappers use a fixed vocabulary, as J6 and the examples above show.
Application services declare one abstract method, `execute` (see S11).

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
