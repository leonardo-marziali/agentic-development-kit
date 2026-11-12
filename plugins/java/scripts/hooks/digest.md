# Java standard (must follow in scope)

This project follows an opinionated Java/Spring Boot standard. The rules
below are the must-follow summary; the `java:*` skills hold the full text
and examples. Break a rule only with a concrete reason, written down. At
Stop, the plugin blocks on rule violations in lines you changed; mark a
justified exception with `// java-rules:allow <ID> <reason>`.

## Java

- J1 Complete Javadoc on public API (`@param`, `@return`, `@throws`,
  `{@link}`); no `@author`/`@version`.
- J2 One Javadoc syntax per project: Markdown `///` on Java 23+, HTML
  before.
- J3 Multi-line comments use `/* */`.
- J4 Comment for the first-time reader: intent, constraints, trade-offs;
  never restate code.
- J5 Descriptive names; domain names match the domain term; technical names
  follow the type (`RestTemplate restTemplate`).
- J6 No redundant object in method names: `projectService.save(project)`.
- J7 Names tell the truth (`assertProjectExists` for a throwing `void`).
- J8 One suffix per concept across the project (`*Config`, never `*Conf`).
- J9 Member order: constants, fields, constructors, public methods, private
  methods, nested types.
- J10 Fields: id, mandatory, optional, technical. Dependencies: services,
  repositories, mappers, clients.
- J11 Arguments most to least important; update = id, body, rest; optional
  last.
- J12 Locals near first use, `final` when immutable; blank lines between
  steps and around log statements.
- J13 `var` only when the right-hand side names the type.
- J14 Multi-line text uses a text block.
- J15 `sealed` for closed hierarchies, pattern matching over casts, records
  for projections and small values.
- J16 No wildcard imports.
- J17 `module-info`/`package-info` when they add value.
- J18 Lowest visibility that works.
- J19 Optional arguments: an overload with only the required ones, routed
  by a `default` method.
- J20 Nullness on every public signature, one library (Spring on Boot 3,
  JSpecify on Boot 4+), non-null by default per package (`@NullMarked`),
  checked by NullAway; `Optional` only as a return type.
- J21–J22 Don't repeat yourself; use the library already on the classpath.
- J23 Static-only classes are `@UtilityClass`.
- J24 Same concept, same type and format across DTOs, domain and entities.

## Build

- B1–B2 Prefer BOM-managed versions; others are a `<artifactId>.version`
  property (Gradle: version catalog).
- B3–B4 Enforce in the build; declare the Java version.
- B5–B6 Eclipse JDT formatting; `@formatter:off/on` only for short blocks
  that read better by hand.
- B7–B8 ArchUnit or Modulith for architecture; generated OpenAPI checked
  against the committed spec.
- B9 Branch coverage on business logic; exclude only generated code.
- B10 Lombok + MapStruct (+ binding) on the processor path; Spring
  component model, constructor injection, unmapped targets are errors.

## Spring Boot

- S1–S3 Lombok where it helps; `@Slf4j`; constructor injection with
  `@RequiredArgsConstructor`, never `@Autowired`.
- S4 `@ConfigurationProperties` records, not `@Value` fields.
- S5 Autoconfiguration and Spring libraries before raw SDKs.
- S6 Controllers and config classes not public; services = public
  interface + package-private impl; internal collaborators package-private.
- S7 Service and repository interfaces speak only domain objects (`Page`/
  `Pageable` allowed); DTOs stop at the controller, entities at the
  repository.
- S8–S9 Controller orchestrates (DTO → domain, `If-Match` → version, call
  service, `ETag` back), no business decisions.
- S10–S12 `<Entity>Service` is small CRUD; a multi-step process is a use
  case `<Entity><Process>Service` with one `handle` method.
- S13 Models: `*ReadDto`, `*WriteDto`, `*FilterDto`, domain, `*Filter`,
  `*Entity` — only those needed.
- S14 Read DTOs `@Value @Builder`; write/filter DTOs `@Data`.
- S15 Entities: no `@Data`/`@EqualsAndHashCode`/`@ToString`; id, version
  and audit have `@Setter(AccessLevel.NONE)`.
- S16–S17 One MapStruct mapper per boundary, in the package it serves; no
  database access in mappers.
- S18–S21 Arguments before `@Mapping`; nested via `uses`; lookups via
  `@Context` maps; no `expression = "java(...)"`, no private helpers.
- S22–S23 Mappers are abstract classes with `public final` nullability
  proxies; every unset target ignored explicitly.
- S24 Fixed method vocabulary: `save`/`update`/`delete`/`find*`; mappers
  `to*`/`update*`; use cases `handle`.
- S25 Package by feature, then layer (`api`, `client.http`, `domain`,
  `messaging`, `persistence`, `scheduler`, `service`), plus `shared`.
- S26–S32 REST level 2: standards first (RFC headers, `ProblemDetail`),
  plural nouns, no verbs, `{projectId}` not `{id}`, method matches action.
- S33 `PATCH` = JSON Merge Patch (or JSON Patch) on the write DTO,
  validated after patching, guarded by `If-Match`.
- S34 DTOs validate shape (400); the domain validates rules (409/422).
- S35–S37 OpenAPI on package-private controller interfaces; examples in
  DTOs; internal endpoints `@Hidden`.
- S38–S39 `Pageable`/`Page` from the service down; `PageableDto`/`PageDto`
  at the API.
- S40–S43 One advice extending `ResponseEntityExceptionHandler`; coded
  domain errors; client-actionable messages, nothing technical; bulk
  operations report every entry.
- S44 Public repository interface over a package-private Spring Data one.
- S45–S47 Generated ids; UTC `Instant`; framework auditing in an
  `AuditEmbeddable`.
- S48–S53 JaVers for field history; no N+1, one round trip per need;
  derived query, JPQL, QueryDSL, native last; Liquibase; filters become
  predicate classes.
- S54–S56 Cache only stale-tolerant data, with a TTL; Logbook with masking.
- S57–S58 One `<Target>HttpClient` per remote system on `RestClient`,
  speaking the domain, with timeouts; Resilience4j per remote.

## Domain and events

- D1 Domain classes are plain Java (Lombok and nullness annotations only).
- D2–D4 Coherent from construction; state changes through behavior; step
  builders for many mandatory fields.
- D5 Ids, version and audit come only from persistence, via one
  `rehydrate` factory used by mappers.
- D6–D7 Explicit state machines; optimistic locking.
- D8–D11 Transactional outbox; idempotent consumers; versioned event
  schemas; locked, switchable scheduled jobs.

## Testing

- T1–T4 Test every branch; `shouldXWhenY` names, `@Nested`,
  `@DisplayName`, AssertJ; parameterize; unit-test domain and services.
- T5–T6 `@WebMvcTest` for controllers; data-store slices and WireMock for
  integrations.
- T7 Never mock value objects or DTOs, never set fields by reflection.
