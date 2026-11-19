---
name: java-testing-standards
description: 'Use when writing or reviewing tests in a Java project that follows the java-standards opt-in. Covers branch coverage of the required suite, shouldXWhenY naming with @Nested and AssertJ, parameterized tests, mandatory unit tests for the domain, application services, commands, mappers, the error handler and the patch applier, a mandatory repository round-trip test per aggregate, optional other slice and integration tests, WireMock, and the shortcuts never to take (rules T1 to T7).'
paths: '**/*.java, **/pom.xml, **/build.gradle*'
---

<!-- Generated from standards/java-standards.md by scripts/build-skills.js. -->
<!-- markdownlint-disable MD013 -->

# Testing standards

Before applying this skill, read `.claude/java-standards.json` at the
repository root. If it doesn't exist, or the file you're working on is
outside its `include`/`exclude` scope, follow the conventions of the
surrounding code instead.

Break a rule only with a concrete reason, and write that reason down. At
Stop, the java plugin blocks on violations in lines you changed; mark a
justified exception with `// java-rules:allow <ID> <reason>`.

## Testing

**T1. Test every branch of the required suite.** Every branch of the code that
T4 and T5 require tests for is tested, and the gate of B9 measures exactly that
code. Other adapter code, such as controllers and outbound clients, is covered
by the optional tests of T6. A rule the suite can't meet would only teach
everyone to ignore it.

**T2. Readable tests.** Name test classes `<Subject>Test` (not `*Tests` or
`*IT`), name tests `shouldXWhenY`, group them with `@Nested` and `@DisplayName`,
and assert with AssertJ.

**T3. Parameterize.** When several tests share the same logic and differ only in
their data, write one parameterized test instead.

**T4. Unit tests are mandatory.** Unit tests cover the domain, the application
services, the commands' validation (see S34), the mappers, and the shared code
that decides something. None of them needs a Spring context or a database.

- **Mappers.** A mapper test builds the generated implementation with its
  converters, such as `new ProjectEntityMapperImpl(new ProjectIdMapper(), ...)`,
  and checks the reconstitution and the constructor MapStruct chose (see S15 and
  S23).
- **The error handler.** `GlobalExceptionHandler` decides every status, code and
  field list the API returns (see S40). A test in `shared.error` constructs
  each exception, calls the handler method and asserts the status, the `code`
  and the `errors`, so a broken mapping can't hide behind a passing controller.
- **The patch applier.** `PatchApplier` implements RFC 7396 itself (see S33).
  A test builds it with `JsonMapper.builder().build()` and the validator of
  `Validation.buildDefaultValidatorFactory()`, and covers removal through
  `null`, nested merges, an unknown field and the validation groups.
- **`CommandCheck`**, because every command relies on it (see S34).

**T5. One integration test is mandatory: the repository round trip.** The
design puts its subtlest code where unit tests can't reach: the dirty-checked
update (see S8), assigned identifiers with a `null` version (see S45), the
forced version increment (see D13) and the events published from the
repository (see D24). Each aggregate's repository adapter therefore has one
slice test, `@DataJpaTest` or the data store's equivalent, on the production
engine (see T6), with the project's migrations, so the sequence and
`ddl-auto=validate` run as in production. It covers:

- **Save and load.** `nextIdentity`, `save` and `getById` return an equal
  aggregate, and the creation event reaches the publisher.
- **Update.** A change saved with `update` is stored, and the version goes up
  by one.
- **Inner entities**, where the aggregate has them. A change confined to one,
  loaded through `getByIdForUpdate`, still increments the root's version.
- **Stale writes.** A write with an outdated version fails at flush.
- **Change history**, where the entity is `@FieldHistory`. The snapshot is
  recorded (see S48).

Flush and clear the persistence context between steps, or the test reads
Hibernate's first-level cache instead of the database. The slice loads no
configuration of its own, so import the adapter, its mapper implementation and
converters, `AggregateEvents`, the auditing configuration with a fixed test
auditor (see S47), and the database container of T6. On Boot 4, `@DataJpaTest` comes from
`spring-boot-starter-data-jpa-test`. **On Boot 3**, it's part of
`spring-boot-starter-test`. Every other integration test stays optional (see
T6).

```java
@DataJpaTest
@Import({JpaProjectRepository.class, ProjectEntityMapperImpl.class, ProjectIdMapper.class, DateMapper.class,
    AuditMapper.class, AggregateEvents.class, JpaAuditingConfig.class, TestAuditorConfig.class,
    PostgresContainerConfig.class})
@RecordApplicationEvents
class JpaProjectRepositoryTest {

    @Autowired
    private ProjectRepository projectRepository;

    @Autowired
    private TestEntityManager testEntityManager;

    @Autowired
    private ApplicationEvents applicationEvents;

    @Test
    void shouldIncrementTheVersionWhenAnUpdateIsFlushed() {

        final ProjectId projectId = projectRepository.nextIdentity();
        projectRepository.save(Project.draft(projectId, new ProjectName("Apollo"), 7L, Instant.EPOCH));
        flushAndClear();

        final Project stored = projectRepository.getById(projectId);
        stored.rename(new ProjectName("Artemis"));
        projectRepository.update(stored);
        flushAndClear();

        final Project updated = projectRepository.getById(projectId);

        assertThat(updated.getName()).isEqualTo(new ProjectName("Artemis"));
        assertThat(updated.getVersion()).isEqualTo(stored.getVersion() + 1);
        assertThat(applicationEvents.stream(ProjectDrafted.class)).hasSize(1);
    }

    // Without it, the next read comes from Hibernate's first-level cache.
    private void flushAndClear() {

        testEntityManager.flush();
        testEntityManager.clear();
    }

}
```

**T6. Hints for integration tests.** The last two hints are rules for the
repository test of T5. The others apply when a project adds more:

- **The cheapest guarantee is a Bruno collection.** Keep a Bruno collection of
  the API in the repository, next to the OpenAPI specification (see B8), with
  assertions on status codes, `ETag` and error codes. Run it with the Bruno CLI
  against a running instance, locally or after a deployment. It exercises the
  routing, the validation, the JSON, the error model and the real database
  together, without any test infrastructure in the build.
- **Slice tests, where a layer earns one.** Controllers with `@WebMvcTest` or
  the GraphQL tester, outbound HTTP clients against WireMock, including timeouts
  and remote errors. Repositories already have theirs (see T5).
- **The production engine, never a substitute.** A repository test runs on the
  same database engine and major version as production. An in-memory database
  such as H2 can't run native migrations or native queries, such as sequences
  (see S45 and S51).
- **Testcontainers, or a fallback.** A container with `@ServiceConnection` needs
  no further configuration. Where CI can't run containers, use a database
  service of the CI system itself, such as a GitHub Actions or GitLab CI service
  container, with `@AutoConfigureTestDatabase(replace = Replace.NONE)`, or the
  engine's own binaries started without Docker, such as zonky's embedded
  PostgreSQL.

**T7. No shortcuts.** Never mock value objects or DTOs, and never set fields by
reflection.
