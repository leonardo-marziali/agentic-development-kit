---
name: java-testing-standards
description: 'Use when writing or reviewing tests in a Java project that follows the java-standards opt-in. Covers branch coverage, shouldXWhenY naming with @Nested and AssertJ, parameterized tests, unit tests for domain and services, slice tests for controllers and integrations, WireMock, and the shortcuts never to take (rules T1 to T7).'
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

**T2. Readable tests.** Name tests `shouldXWhenY`, group them with `@Nested` and
`@DisplayName`, and assert with AssertJ.

**T3. Parameterize.** When several tests share the same logic and differ only in
their data, write one parameterized test instead.

**T4. Unit tests.** Unit tests cover domain and service logic.

**T5. Slice tests for controllers.** Test controllers with `@WebMvcTest` or the
GraphQL tester, so routing, validation, JSON and error mapping are all
exercised.

**T6. Slice tests for integrations.** Repositories with custom queries are
tested with the data store's slice test, such as `@DataJpaTest`. Outbound HTTP
clients are tested against WireMock, including timeouts and remote errors.

**T7. No shortcuts.** Never mock value objects or DTOs, and never set fields by
reflection.
