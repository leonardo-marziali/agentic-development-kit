# Java standard (must follow in scope)

This project follows an opinionated Java/Spring Boot standard. The rules
below are the must-follow summary; the `java:*` skills hold the full text
and examples. Break a rule only with a concrete reason, written down. At
Stop, the plugin blocks on rule violations in lines you changed; mark a
justified exception with `// java-rules:allow <ID> <reason>`.

## Java

- J1 Complete Javadoc on public API; no `@author`/`@version`.
- J2 One Javadoc syntax per project: Markdown `///` on Java 23+, HTML
  before.
- J3 Multi-line comments use `/* */`.
- J4 Comments give intent, constraints, trade-offs; never restate code.
- J5 Descriptive names; domain names match the domain term; technical names
  follow the type (`RestClient restClient`).
- J6 No redundant object in method names: `projectRepository.save(project)`.
- J7 Names tell the truth (`assertProjectExists` throws).
- J8 One suffix per concept across the project (`*Config`, never `*Conf`).
- J9 Member order: constants, fields, constructors, public, then protected
  and package-private, then private methods, nested types.
- J10 Fields: id, mandatory, optional, technical.
- J11 Arguments most to least important; a change = id, new values, rest;
  optional last.
- J12 Locals near first use, `final` when immutable; blank lines between
  steps.
- J13 `var` only when the right-hand side names the type.
- J14 Multi-line text uses a text block.
- J15 `sealed` for closed hierarchies, pattern matching, records.
- J16 No wildcard imports.
- J17 `module-info`/`package-info` when they add value.
- J18 Lowest visibility that works.
- J19 Optional arguments: an overload with only the required ones.
- J20 Nullness on every public signature with JSpecify on every framework
  version, `@NullMarked` per package, checked by NullAway; `Optional` only
  as a return type.
- J21–J22 Every rule or decision has one home (look-alike code stays
  apart); use the library already there.
- J23 Static-only classes are `@UtilityClass`.
- J24 Same concept, same type and format across models; own aggregate ids
  are typed value objects in the core.
- J25 An empty method or constructor body holds a comment saying why.
- J26 More than 7 parameters: one parameter object with a fluent builder,
  plus a `Consumer<X.Builder>` overload (AWS SDK v2 style).

## Build

- B1–B2 Prefer BOM-managed versions; others are a `<artifactId>.version`
  property (Gradle: version catalog).
- B3–B4 Enforce in the build; declare the Java version.
- B5–B6 Eclipse JDT formatting; `@formatter:off/on` only for short blocks.
- B7–B8 Spring Modulith between features, ArchUnit inside each; generated
  OpenAPI checked against the committed spec.
- B9 Branch coverage on business logic; exclude only generated code.
- B10 Lombok + MapStruct (+ binding) on the processor path, unmapped
  targets are errors; one root `lombok.config` (B9, J20, J26).

## Spring Boot

- S1–S3 Lombok; `@Slf4j`; `@RequiredArgsConstructor`, never `@Autowired`.
- S4 `@ConfigurationProperties` records, not `@Value` fields.
- S5 Autoconfiguration and Spring libraries before raw SDKs.
- S6 Controllers and config classes not public; application services,
  query services and repositories = public port + package-private impl.
- S7 Writes: application services take their own command, return nothing
  or the new id. Reads: a query service (`ProjectQueries`) returns read
  models. DTOs stop at the controller, entities at persistence.
- S8–S9 Controller maps DTO + id + `If-Match` to a command, calls the
  service, reads back via the query service, returns `ETag`; no decisions.
- S10–S11 One application service per use case, verb first in the domain
  language: public port `ArchiveProject`, record `ArchiveProjectCommand`
  (self-validating, step builder, never shared), package-private
  `@Service ArchiveProjectService` with a single `execute(command)`.
- S12 Services orchestrate, the domain decides; never return an aggregate;
  `@Service` only on application services.
- S13 Models: `*ReadDto`, `*WriteDto`, `*FilterDto`, `*Command`,
  `*ReadModel`, `*Filter`, aggregate, `*Entity`: only those needed.
- S14 Read DTOs `@Value @Builder`; write/filter DTOs `@Data`.
- S15 Entities are anemic, package-private records of the aggregate: no
  `@Data`/`@EqualsAndHashCode`/`@ToString`; id, tenant, version and audit
  have `@Setter(AccessLevel.NONE)`; a `@Default` constructor for MapStruct.
- S16–S23 One MapStruct mapper per boundary, in its package; `uses`,
  `@Context` lookups, no `java(...)` expressions; abstract classes with
  `public final` nullability proxies; unset targets ignored explicitly.
- S24 Repositories `save`/`update`/`delete`/`getById`/`getByIdForUpdate`/
  `findById`/`nextIdentity`; query services `get*` (throws) and `find*`;
  mappers `to*`/`update*`.
- S25 Package by feature, then `api`, `application`, `domain`, `client`,
  `messaging.in`/`.out`, `persistence`, `scheduler`, plus `shared`.
- S26–S32 REST level 2: standards first (RFC headers, `ProblemDetail`),
  plural nouns, no verbs, `{projectId}` not `{id}`, method matches action;
  a state change is `PUT /projects/{projectId}/status`.
- S33 `PATCH` = JSON Merge Patch (or JSON Patch) on the write DTO,
  validated after patching, guarded by `If-Match`.
- S34 DTOs validate shape, commands validate themselves (400); the domain
  enforces invariants (409/422).
- S35–S37 OpenAPI on controller interfaces, with examples; internal
  endpoints `@Hidden`.
- S38–S39 `Pageable`/`Page` from the service down; `PageableDto`/`PageDto`
  at the API.
- S40–S43 One advice extending `ResponseEntityExceptionHandler` maps sealed,
  HTTP-free domain exception categories to statuses; coded errors;
  client-actionable messages; bulk operations report every entry.
- S44 Repository port in `domain` over a package-private Spring Data one.
- S45–S47 The repository allocates ids (`nextIdentity()`, no
  `@GeneratedValue`); UTC `Instant`; framework auditing in an
  `AuditEmbeddable`, only read models carry it.
- S48–S53 JaVers history; no N+1; derived query, JPQL, QueryDSL, native
  last; Liquibase; filters become predicates.
- S54–S56 Cache only stale-tolerant data, with a TTL; Logbook with masking.
- S57–S58 One `<Target>HttpClient` per remote system on `RestClient`
  (Boot 4: an HTTP service group), implementing a domain port such as
  `PaymentGateway`, with timeouts; Resilience4j per remote.
- S59 More than 2 operations of a remote with an OpenAPI spec: generate
  the client, spec committed, generated code behind the client.
- S60 No URL in code: base URL and timeouts in properties
  (`spring.http.serviceclient.<group>.*` on Boot 4); a hand-written client
  with many paths gets its own file via `@PropertySource`.
- S61 Property keys: dotted hierarchy, general to specific, kebab-case.
- S62 Controller paths are keys in `api-paths.properties` (public, `api.`)
  or `internal-api-paths.properties` (`@Hidden`, `internal.api.`); mappings
  use one placeholder: `@GetMapping("${api.v1.projects.id.path}")`.

## Domain, hexagon and events

- D1–D4 Code speaks the ubiquitous language; bounded contexts written
  down; foreign models translated in the adapter (anti-corruption layer).
- D5–D8 Hexagon per feature: core = `application` (driving ports) +
  `domain` (driven ports, named by need: `PaymentGateway`); adapters only
  translate and delegate, never call each other; dependencies point
  inward (ArchUnit).
- D9–D12 Aggregates are consistency boundaries; reference others by id;
  one aggregate per transaction (events for the rest); one repository per
  root.
- D13–D14 Version on the root (`assertVersion`); reads bypass the
  aggregate through a query service.
- D15 Domain classes are plain Java (Lombok, JSpecify only); no clock or
  random in the domain.
- D16–D18 Created by a named factory (`Project.draft(...)`); state with
  rules changes through behavior; step builders for many mandatory values.
- D19 Id from creation via `nextIdentity()`; version read-only; audit
  never in the domain; only persistence calls `reconstitute`.
- D20–D21 Domain services for cross-aggregate rules; explicit state
  machines.
- D22–D23 Value objects are immutable, self-validating records; values that
  belong together are one type in every layer (`@Embeddable`, no table).
- D24–D25 Aggregates record past-tense events, repositories publish them;
  integration events are a separate contract in `messaging.out`.
- D26–D29 Outbox (Spring Modulith); idempotent consumers via an inbox;
  versioned schemas; locked, switchable jobs that call a service.

## Testing

- T1–T4 Test every branch; classes `*Test`, `shouldXWhenY` names, `@Nested`,
  `@DisplayName`, AssertJ; parameterize; unit tests are mandatory for the
  domain, application services, command validation and mappers.
- T5–T6 Integration tests are optional; when present, slices and WireMock.
- T7 Never mock value objects or DTOs, never set fields by reflection.
