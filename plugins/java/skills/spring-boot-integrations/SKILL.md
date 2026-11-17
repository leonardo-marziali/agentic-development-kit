---
name: spring-boot-integrations
description: 'Use when adding caching, Logbook HTTP logging, outbound HTTP clients or Resilience4j in a project that follows the java-standards opt-in. Covers stale-tolerant Spring Cache use, Logbook configuration and masking, one client per remote system implementing a driven port, RestClient and Boot 4 HTTP service groups, timeouts, OAuth2 client credentials, fault tolerance, clients generated from OpenAPI specifications and outbound URLs kept in properties (rules S54 to S60).'
paths: '**/*.java, **/pom.xml, **/build.gradle*'
---

<!-- Generated from standards/java-standards.md by scripts/build-skills.js. -->
<!-- markdownlint-disable MD013 -->

# Caching, HTTP logging and outbound HTTP

Before applying this skill, read `.claude/java-standards.json` at the
repository root. If it doesn't exist, or the file you're working on is
outside its `include`/`exclude` scope, follow the conventions of the
surrounding code instead.

Break a rule only with a concrete reason, and write that reason down. At
Stop, the java plugin blocks on violations in lines you changed; mark a
justified exception with `// java-rules:allow <ID> <reason>`.

## Caching

**S54. Cache data that can tolerate staleness.** Configuration values, lookup
tables and any other data that changes rarely and can safely be slightly stale
go through Spring Cache.

- **Limit staleness:** every cache has a TTL, and writes use `@CacheEvict`.
- **Mind the cluster:** a local cache such as Caffeine evicts only on its own
  instance, so other instances catch up at the TTL. If that isn't acceptable,
  use a shared cache such as Redis.
- **Mind the proxy:** `@Cacheable` has no effect when a method calls another
  method on the same class.
- **Cache immutable values:** a local cache returns the same instance to every
  caller, so a caller that mutates it changes the cached value.

## HTTP logging

**S55. Zalando Logbook in every environment.** Use Logbook for visibility on raw
HTTP traffic. It stays active in production at `TRACE`, which requires enabling
that one logger explicitly. It must not slow the application down, make it
heavier or fill the logs with personal data:

- In production, log bodies only for failed requests with
  `logbook.strategy: body-only-if-status-at-least`. Bodies of successful
  requests carry personal data that an obfuscation list will never fully catch.
  Full bodies are for non-production environments.
- Limit the size of logged bodies.
- Exclude health checks and binary or large-payload paths. Truncation only
  shortens what gets written, so a body that is too large to buffer must be
  excluded entirely.

**S56. Mask sensitive values.** Logs never contain credentials, tokens or
presigned URLs. Setting a Logbook obfuscation list replaces its defaults, so
list everything explicitly, including `Authorization`.

```yaml
logging:
  level:
    org.zalando.logbook: TRACE

logbook:
  strategy: body-only-if-status-at-least
  minimum-status: 400
  predicate:
    exclude:
      - path: /actuator/**
  write:
    max-body-size: 4096
  obfuscate:
    headers: [Authorization, Cookie, Set-Cookie, X-Api-Key]
    parameters: [access_token, X-Amz-Signature]
    json-body-fields: [password, token, secret]
```

## Outbound HTTP

**S57. One client per remote system.** Every remote HTTP API gets its own
client, named `<Target>HttpClient` and placed in the `client.http` package of
the feature that uses it, for example `payment.client.http.PayPalHttpClient`.

- **It implements a port.** Like a repository (see S44), the client sits behind
  a public driven port in `domain`, named by what the core needs, such as
  `PaymentGateway` (see D6). The port takes and returns domain objects.
  `PayPalHttpClient` implements it, and it and the remote API's DTOs are
  package-private, so no external model leaks into the services. This is the
  anti-corruption layer of D4.
- **Built on `RestClient`, configured the Spring Boot way.** Use an
  `@HttpExchange` interface backed by `RestClient`, or `RestClient` directly,
  and configure it through properties and Spring Boot's builder customizers
  rather than by hand (see S5). With more than two operations, the interface is
  generated from the remote's OpenAPI specification (see S59).
  - **On Boot 4**, an `@HttpExchange` interface belongs to an HTTP service
    group, one per remote system. `@ImportHttpServices` registers it, and Spring
    Boot includes auto-configuration support and configuration properties for
    HTTP Service Clients, configured per group with the pattern
    `spring.http.serviceclient.<group-name>.*` (see S60).
  - **On Boot 3**, and for a client that uses `RestClient` directly, build it
    from Spring Boot's `RestClient.Builder` and bind its base URL and timeouts
    with `@ConfigurationProperties` (see S4 and S60).
- **Always set timeouts.** Connect and read timeouts are explicit for every
  client. A default of "wait forever" isn't acceptable.
- **Authentication through Spring.** OAuth2 client credentials go through Spring
  Security's OAuth2 client support, which obtains and refreshes the token, and
  Spring Security 7 applies it to HTTP service groups. Never build an
  `Authorization` header by hand from a stored token.
- **Logging through Logbook.** Register Logbook's interceptor on the client, so
  outbound traffic follows the same rules as inbound traffic (see S55 and S56).
- **Errors become our errors.** A status handler translates remote errors into
  our exception hierarchy (see S40). The remote body is logged, never returned
  to our client (see S42).
- **Tested with WireMock** when the project has integration tests (see T6).

**S58. Resilience4j for fault tolerance.** When a remote call needs a circuit
breaker, a bulkhead or a rate limiter, use Resilience4j through its Spring Boot
integration, and configure each instance in properties (see S5). For retries
alone, Spring Framework 7 and later has `@Retryable` built in.

- Retry only operations that are safe to repeat: idempotent methods, or calls
  that carry an idempotency key.
- Give each remote system its own named instance, so one failing dependency
  doesn't trip the others.
- A fallback returns something meaningful or fails with a clear error. It never
  hides the failure behind an empty result.

**S59. Generated clients from OpenAPI.** When we call more than two operations
of a remote API that has an OpenAPI specification, the client is generated with
OpenAPI Generator rather than written by hand. For a public product, look for
its specification online first: the vendor's developer portal, its GitHub
organization, or the APIs.guru directory. For an internal service, use the
specification its build generates (see B8). With one or two operations, a
hand-written client is simpler than a generator setup.

- **The specification is committed** under `src/main/resources/openapi/`, so a
  vendor change arrives as a reviewed diff. The generated code isn't committed:
  the build generates it.
- **The paths come from the specification.** A generated interface carries the
  remote's paths, so they aren't repeated in properties. Path properties (see
  S60) are only for hand-written clients.
- **Spring HTTP interfaces.** Use the `spring` generator with the
  `spring-http-interface` library, so the generated interfaces run on our
  configured `RestClient` (see S57). On Boot 3,
  `useHttpServiceProxyFactoryInterfacesConfigurator` generates the class that
  creates them. On Boot 4, register them in the remote's HTTP service group with
  `@ImportHttpServices` instead.
- **Behind the client.** The generated API and models are used only by the
  `<Target>HttpClient` implementation, which maps them to domain objects with a
  MapStruct mapper, so nothing generated leaks into the services.

```xml
<plugin>
  <groupId>org.openapitools</groupId>
  <artifactId>openapi-generator-maven-plugin</artifactId>
  <version>${openapi-generator-maven-plugin.version}</version>
  <executions>
    <execution>
      <id>paypal-payments</id>
      <goals>
        <goal>generate</goal>
      </goals>
      <configuration>
        <inputSpec>${project.basedir}/src/main/resources/openapi/paypal-payments.yaml</inputSpec>
        <generatorName>spring</generatorName>
        <library>spring-http-interface</library>
        <apiPackage>com.company.app.payment.client.http.paypal.api</apiPackage>
        <modelPackage>com.company.app.payment.client.http.paypal.model</modelPackage>
        <configOptions>
          <useSpringBoot3>true</useSpringBoot3>
          <useHttpServiceProxyFactoryInterfacesConfigurator>true</useHttpServiceProxyFactoryInterfacesConfigurator>
          <openApiNullable>false</openApiNullable>
        </configOptions>
      </configuration>
    </execution>
  </executions>
</plugin>
```

On Spring Boot 4, set `useSpringBoot4` instead of `useSpringBoot3`.

**S60. Outbound URLs live in properties.** No URL is written in code. Values
that change per environment come from environment variables.

- **Base URL and timeouts.** On Boot 4, an HTTP service group's properties hold
  them, under `spring.http.serviceclient.<group-name>.*` (see S5 and S57), with
  defaults for every client under `spring.http.clients.*`. On Boot 3, and for a
  client that uses `RestClient` directly, they're our own properties, named as
  S61 describes and bound with `@ConfigurationProperties` (see S4).
- **Paths.** A generated client takes its paths from the specification (see
  S59). A hand-written client reads them from properties, composed with
  placeholders.
- **Many endpoints, one file.** A hand-written client with many endpoints gets
  its own file, such as `carrier-api.properties`, loaded with `@PropertySource`
  the way `api-paths.properties` is (see S62), so `application.properties` stays
  readable.

```properties
### PAYPAL: generated client, Boot 4 HTTP service group ###
spring.http.serviceclient.paypal.base-url=${PAYPAL_API_BASE_URL:https://api-m.sandbox.paypal.com}
spring.http.serviceclient.paypal.connect-timeout=2s
spring.http.serviceclient.paypal.read-timeout=5s
```

```java
@Configuration(proxyBeanMethods = false)
@ImportHttpServices(group = "paypal", types = PaymentsApi.class)
class PayPalHttpClientConfig {
    // Registers the generated PayPal interfaces in the "paypal" group (see S59).
}
```

```properties
### CARRIER: hand-written client ###
carrier.api.protocol=https
carrier.api.host=${CARRIER_API_HOST:api.sandbox.carrier.example}
carrier.api.version=v1
carrier.api.base-url=${carrier.api.protocol}://${carrier.api.host}/${carrier.api.version}
carrier.api.shipments-path=/shipments
carrier.api.shipment-path=${carrier.api.shipments-path}/{shipmentId}
carrier.api.connect-timeout=2s
carrier.api.read-timeout=5s
```

```java
@Configuration(proxyBeanMethods = false)
@PropertySource("classpath:carrier-api.properties")
@EnableConfigurationProperties(CarrierApiProperties.class)
class CarrierHttpClientConfig {
    // Loads the carrier's endpoints and binds them to CarrierApiProperties.
}

@ConfigurationProperties("carrier.api")
record CarrierApiProperties(String baseUrl,
    String shipmentsPath,
    String shipmentPath,
    Duration connectTimeout,
    Duration readTimeout) {}
```
