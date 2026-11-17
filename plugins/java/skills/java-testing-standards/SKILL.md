---
name: java-testing-standards
description: 'Use when writing or reviewing tests in a Java project that follows the java-standards opt-in. Covers branch coverage, shouldXWhenY naming with @Nested and AssertJ, parameterized tests, mandatory unit tests for the domain, application services and mappers, optional slice and integration tests, WireMock, and the shortcuts never to take (rules T1 to T7).'
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

**T1. Test every branch.** All code branches are tested.

**T2. Readable tests.** Name test classes `<Subject>Test` (not `*Tests` or
`*IT`), name tests `shouldXWhenY`, group them with `@Nested` and `@DisplayName`,
and assert with AssertJ.

**T3. Parameterize.** When several tests share the same logic and differ only in
their data, write one parameterized test instead.

**T4. Unit tests are mandatory.** Unit tests cover the domain, the application
services, the commands' validation (see S34) and the mappers. A mapper test
builds the generated implementation with its converters, such as
`new ProjectEntityMapperImpl(new ProjectIdMapper(), ...)`, and checks the
reconstitution and the constructor MapStruct chose (see S15 and S23), with no
Spring context and no database.

**T5. Integration tests are optional.** Unit tests are the required suite.
Integration tests are a choice per project, so T6 is a set of hints, not rules,
and nothing in the build requires them.

**T6. Hints for integration tests.** When a project has them, or before it adds
them:

- **The cheapest guarantee is a Bruno collection.** Keep a Bruno collection of
  the API in the repository, next to the OpenAPI specification (see B8), with
  assertions on status codes, `ETag` and error codes. Run it with the Bruno CLI
  against a running instance, locally or after a deployment. It exercises the
  routing, the validation, the JSON, the error model and the real database
  together, without any test infrastructure in the build.
- **Slice tests, where a layer earns one.** Controllers with `@WebMvcTest` or
  the GraphQL tester, outbound HTTP clients against WireMock, including timeouts
  and remote errors, and repositories with the data store's slice test, such as
  `@DataJpaTest`. The repository round trip (`save`, `getById`, `update`,
  `getById`) covers what unit tests can't: the dirty-checked update and the
  change history (see S8 and S48).
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
