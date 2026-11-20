---
name: spring-rest-api-design
description: 'Use when adding or changing REST endpoints, request and response DTOs, validation, OpenAPI annotations, pagination or error handling in a project that follows the java-standards opt-in. Covers Richardson level 2, standard HTTP and RFC features, resource naming, state changes as a PUT on the state, PATCH with JSON Merge Patch and JSON Patch validated with the groups of the PUT, the three layers of validation with limits owned by value objects, OpenAPI documentation, PageableDto and PageDto, ProblemDetail errors mapped from HTTP-free domain exception categories, optimistic-locking failures answered with 412, bulk operations and controller paths kept in api-paths.properties (rules S26 to S43, S61 and S62).'
paths: '**/*.java, **/pom.xml, **/build.gradle*'
---

<!-- Generated from standards/java-standards.md by scripts/build-skills.js. -->
<!-- markdownlint-disable MD013 -->

# REST API design

Before applying this skill, read `.claude/java-standards.json` at the
repository root. If it doesn't exist, or the file you're working on is
outside its `include`/`exclude` scope, follow the conventions of the
surrounding code instead.

Break a rule only with a concrete reason, and write that reason down. At
Stop, the java plugin blocks on violations in lines you changed; mark a
justified exception with `// java-rules:allow <ID> <reason>`.

## REST design

**S26. Richardson level 2.** REST APIs are built on resources, HTTP methods and
status codes, used as HTTP defines them.

**S27. Use the standard first.** If HTTP or an RFC already covers a feature, use
it instead of inventing a field, header or endpoint. Don't introduce custom `X-`
headers when a standard one exists.

| Need                      | Standard                                             |
| ------------------------- | ---------------------------------------------------- |
| Created resource address  | `201` with `Location` (RFC 9110)                     |
| Representation format     | `Accept` and `Content-Type` (RFC 9110)               |
| Lost-update protection    | `ETag`, `If-Match` and `412` (RFC 9110)              |
| Update without `If-Match` | `428` (RFC 6585)                                     |
| Conditional reads         | `ETag`, `If-None-Match` and `304` (RFC 9110)         |
| Response caching          | `Cache-Control` (RFC 9111)                           |
| Rate limiting             | `429` with `Retry-After` (RFC 6585, RFC 9110)        |
| Error body                | `ProblemDetail` (RFC 9457)                           |
| Partial update            | JSON Merge Patch (RFC 7396) or JSON Patch (RFC 6902) |

**S28. Nouns in endpoints.** Paths name resources and never contain verbs. The
HTTP method is the verb.

| Avoid                       | Prefer                    |
| --------------------------- | ------------------------- |
| `POST /getProjects`         | `GET /projects`           |
| `GET /deleteProject?id=42`  | `DELETE /projects/42`     |
| `POST /projects/42/archive` | `PUT /projects/42/status` |

**A state change is a `PUT` on the state.** A business action that moves a
resource to another state is a `PUT` on its state sub-resource, such as
`PUT /projects/{projectId}/status` with `{"status": "ARCHIVED"}`. The controller
maps the target state to the business action (see S10). Turning the action into
a noun, such as `POST /projects/42/archival`, is also valid REST, but it isn't
used here, so every state change has the same shape.

**S29. Plural collection names.** A path segment that names a collection is
plural, and a single resource is addressed by its identifier inside that
collection. The same plural name serves both, so every resource follows one
pattern.

| Avoid                  | Prefer                   |
| ---------------------- | ------------------------ |
| `GET /project/42`      | `GET /projects/42`       |
| `GET /project/42/task` | `GET /projects/42/tasks` |

**S30. Path variables named after their resource.** A path variable is named
after the resource it identifies, never just `id`, so nested paths stay
unambiguous and the name tells what the value refers to. The controller
parameter carries the same name, so `@PathVariable` needs no explicit value.
This relies on the `-parameters` compiler flag, which the Spring Boot parent
sets; a build without the parent must set it too.

| Avoid                           | Prefer                                 |
| ------------------------------- | -------------------------------------- |
| `/projects/{id}`                | `/projects/{projectId}`                |
| `/projects/{id}/tasks/{taskId}` | `/projects/{projectId}/tasks/{taskId}` |

**S31. Clear resource segmentation.** Resources have clear boundaries, and a
client shouldn't have to orchestrate many requests to compose what it needs. If
clients always need related data together, return it in one representation and
let the server fetch it efficiently (see S49).

**S32. Methods match what happens.** Each HTTP method matches the operation it
performs. A read is never a `POST`.

| Method   | Use for                    | Safe | Idempotent |
| -------- | -------------------------- | ---- | ---------- |
| `GET`    | Read                       | Yes  | Yes        |
| `POST`   | Create, or start a process | No   | No         |
| `PUT`    | Replace a whole resource   | No   | Yes        |
| `PATCH`  | Change part of a resource  | No   | No         |
| `DELETE` | Remove                     | No   | Yes        |

**S33. `PATCH` is JSON Merge Patch, or JSON Patch when it fits better.**

- **JSON Merge Patch by default.** Partial updates follow RFC 7396 with the
  media type `application/merge-patch+json`. The client sends only the fields it
  changes, and `null` removes a field. It is the simplest format for clients and
  covers most resources.
- **JSON Patch when the resource needs it.** Use RFC 6902 with
  `application/json-patch+json` when Merge Patch can't express the change:
  editing single array elements, or guarding a change with a `test` operation.
  Because the patch applies to a DTO, a field set to `null` and a removed field
  end up the same, so that difference never justifies JSON Patch. A resource can
  accept both on the same path, routed by `consumes`.
- **Patch the write DTO, not the entity.** Clients can then reach only writable
  fields.
- **Validate after patching, with the groups of the `PUT`.** Spring validates
  the request body, which here is the patch document, so the patched DTO has to
  be validated explicitly. It goes through the same validation groups as the
  operation's `PUT` body (see S34), so both methods enforce the same rules.
- **Protect against lost updates.** The read and the update run in separate
  transactions (see S9), so require `If-Match` and pass the version down as in
  S8 (see D13).
- **Use the maintained artifact for JSON Patch.** Use
  `io.github.vishwakarma:zjsonpatch`, which is the project's current home, with
  `Jackson3JsonPatch` for Jackson 3. Its Jackson dependency is optional, so
  declare it. The old `com.flipkart.zjsonpatch:zjsonpatch` artifact stopped at
  0.4.16 in 2023. **On Boot 3** (Jackson 2), the same artifact offers
  `JsonPatch`, and `PatchApplier` below uses `ObjectMapper` and catches the
  checked `JsonProcessingException` instead.

```java
// Controller
@Override
public ResponseEntity<ProjectReadDto> mergePatch(Long projectId, JsonNode mergePatch,
    String ifMatch) {

    final ProjectId id = new ProjectId(projectId);
    final ProjectWriteDto current = projectApiMapper.toWriteDto(projectQueries.getById(id));
    final ProjectWriteDto patched = patchApplier.applyMergePatch(mergePatch, current, ProjectWriteDto.class,
        OnUpdate.class);

    updateProjectDetails.execute(projectApiMapper.toUpdateDetailsCommand(id, patched, ETags.toVersion(ifMatch)));

    final ProjectReadModel updatedProject = projectQueries.getById(id);
    final Map<Long, UserSummary> usersById = userQueries.findSummaries(Set.of(updatedProject.ownerId()));

    return ResponseEntity.ok()
                         .eTag(ETags.of(updatedProject.version()))
                         .body(projectApiMapper.toReadDto(updatedProject, usersById));
}

// shared.web. Jackson 3: JsonMapper, JsonNode and the exceptions are in tools.jackson.
@Component
@RequiredArgsConstructor
public class PatchApplier {

    private final JsonMapper jsonMapper;

    private final Validator validator;

    // The groups are those of the operation's PUT body, such as OnUpdate (see S34).
    public <T> T applyJsonPatch(JsonNode jsonPatch, T source, Class<T> type, Class<?>... groups) {

        final JsonNode patched = Jackson3JsonPatch.apply(jsonPatch, jsonMapper.valueToTree(source));

        return readAndValidate(patched, type, groups);
    }

    public <T> T applyMergePatch(JsonNode mergePatch, T source, Class<T> type, Class<?>... groups) {

        final JsonNode patched = merge(jsonMapper.valueToTree(source), mergePatch);

        return readAndValidate(patched, type, groups);
    }

    // The merge algorithm defined in RFC 7396, section 2.
    private JsonNode merge(JsonNode target, JsonNode patch) {

        if (!patch.isObject()) {
            return patch;
        }

        final ObjectNode result = target instanceof ObjectNode objectNode ? objectNode : jsonMapper.createObjectNode();

        patch.properties().forEach(entry -> {
            if (entry.getValue().isNull()) {
                result.remove(entry.getKey());
            } else {
                result.set(entry.getKey(), merge(result.path(entry.getKey()), entry.getValue()));
            }
        });

        return result;
    }

    private <T> T readAndValidate(JsonNode patched, Class<T> type, Class<?>... groups) {

        final T result = read(patched, type);
        final Set<ConstraintViolation<T>> violations = validator.validate(result, groups);

        if (!violations.isEmpty()) {
            throw new ConstraintViolationException(violations);
        }

        return result;
    }

    /*
     * Spring Boot ignores unknown JSON properties by default. Here that would
     * silently drop a patched field that doesn't exist on the DTO.
     */
    private <T> T read(JsonNode patched, Class<T> type) {

        // Jackson 3's exceptions are unchecked; this one is translated to our own (see S40).
        try {
            return jsonMapper.readerFor(type)
                             .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                             .treeToValue(patched, type);
        } catch (JacksonException exception) {
            throw new InvalidPatchResultException(exception);
        }
    }

}
```

Failures map to these statuses. A patched DTO that no longer reads as the DTO,
or breaks its constraints, gets the same `400` and field list as a `PUT` body
with the same fault (see S34). RFC 5789 also allows `422` there, but one rule
gives one answer, whatever the method. `422` stays for a patch that can't be
applied at all.

| Failure                       | Exception                       | Status |
| ----------------------------- | ------------------------------- | ------ |
| Malformed JSON in the request | Handled by Spring               | `400`  |
| Invalid JSON Patch document   | `InvalidJsonPatchException`     | `400`  |
| Wrong media type              | Handled by Spring               | `415`  |
| Failed `test` operation       | `JsonPatchTestFailedException`  | `409`  |
| Patch can't be applied        | `JsonPatchApplicationException` | `422`  |
| Patched result has bad fields | `InvalidPatchResultException`   | `400`  |
| Patched result fails rules    | `ConstraintViolationException`  | `400`  |

## REST validation

**S34. Three layers of validation, each with its own job.** Every adapter can
call the core, so the core can't trust any of them to validate for it (Hombergs,
ch. 4).

- **REST DTOs** check what an HTTP request looks like: required fields, lengths,
  formats, ranges and patterns. A violation returns `400`, with every invalid
  field listed (see S42), and the annotations also document the contract (see
  S35). Use Jakarta Validation annotations, and create a custom annotation when
  the standard ones can't express the check. Use validation groups (`OnCreate`,
  `OnUpdate`) when rules differ by operation:
  - **Each group extends `Default`**, so `@Validated(OnUpdate.class)` still
    checks the constraints that have no group. Without it, those constraints
    would silently stop running.
  - **One operation, one set of groups.** A `PUT` body is validated with
    `@Validated(OnUpdate.class)` on its `@RequestBody`, and the patched DTO of
    the same resource with the same group (see S33).
  - **One answer per broken rule.** Every DTO violation returns `400` with the
    same field list, whether it comes from a `PUT` body, a patched DTO or a
    command (see S40).
  - **Constraints on DTOs, not on controller parameters.** A constraint such as
    `@Positive` on a `@PathVariable` makes Spring validate the whole method, and
    a body violation then arrives as `HandlerMethodValidationException` instead
    of `MethodArgumentNotValidException`, which the handler of S40 covers.
    Identifiers are checked by their value object anyway (see D22).

  ```java
  // shared.web
  public interface OnUpdate extends Default {}
  ```

- **Commands** validate themselves in their compact constructors (see S11), so
  every adapter, REST, messaging or scheduler, passes through the same checks.
  `CommandCheck` collects every violation and throws one
  `InvalidCommandException`. Over REST it returns `400` like a DTO violation. In
  messaging it sends the message to the dead-letter table (see D27). In a
  scheduled job it's a bug, logged at `error` (see D29).
- **The domain** enforces business invariants, such as allowed state transitions
  or a uniqueness that depends on other data, and its value objects enforce
  their own limits (see D22). A violation throws a coded domain exception (see
  S40 and S41): `400` for a value object that rejects its input, usually `409`
  or `422` for the rest.

A limit is one constant, defined once (see J21) on the value object that
enforces it, such as `ProjectName.MAX_LENGTH`. The DTO and the command reference
it, as in `@Size(max = ProjectName.MAX_LENGTH)`, and repeat the check only so
that a client learns about every invalid field at once. The value object stays
the authority, whichever adapter or use case reaches the aggregate.

```java
// shared.application
public final class CommandCheck {

    private final Class<?> commandType;

    private final List<FieldViolation> violations = new ArrayList<>();

    private CommandCheck(Class<?> commandType) {

        this.commandType = commandType;
    }

    public static CommandCheck of(Class<?> commandType) {

        return new CommandCheck(commandType);
    }

    public CommandCheck notNull(String field, @Nullable Object value) {

        if (value == null) {
            violations.add(new FieldViolation(field, "must be provided"));
        }

        return this;
    }

    public CommandCheck notBlank(String field, @Nullable String value) {

        if (value == null || value.isBlank()) {
            violations.add(new FieldViolation(field, "must not be blank"));
        }

        return this;
    }

    // A null value passes: notNull or notBlank decide whether it's required.
    public CommandCheck maxLength(String field, @Nullable String value, int maxLength) {

        if (value != null && value.length() > maxLength) {
            violations.add(new FieldViolation(field, "must have at most %d characters".formatted(maxLength)));
        }

        return this;
    }

    public CommandCheck notNegative(String field, long value) {

        if (value < 0) {
            violations.add(new FieldViolation(field, "must not be negative"));
        }

        return this;
    }

    public void throwIfInvalid() {

        if (!violations.isEmpty()) {
            throw new InvalidCommandException(commandType.getSimpleName(), violations);
        }
    }

}

public record FieldViolation(String field, String message) {}
```

## OpenAPI

**S35. Document everything.** Every public API is documented with OpenAPI
annotations, and everything that can be documented is.

- Always set an operation ID, a short summary and a meaningful description.
- Annotations live on controller interfaces with package-level visibility, so
  implementations contain only logic.
- Object query parameters use `@ParameterObject` to expand them into individual
  parameters.
- Reuse composed annotations such as `@BadRequestResponse`.
- Document every status an operation can actually return.

**S36. Examples.** Provide examples for requests (parameters, headers, bodies)
and responses, using meaningful domain data that stays coherent across the whole
specification. Write them inside the read and write DTOs, not in the
controllers. Path parameters and headers have no DTO, so their examples are the
exception and stay on the controller interface.

**S37. Internal APIs stay out of the specification.** Internal endpoints, such
as event callbacks and HTTP RPCs, are marked `@Hidden`. They aren't part of the
public contract, so S26 to S32 don't bind them, and an RPC may use a verb.
`@Hidden` only removes an endpoint from the documentation. It is still
reachable, so it needs its own access control.

**Event callbacks answer `202` and judge nothing.** An internal callback that
delivers an event takes the raw body as a `String`, stores it in the inbox (see
D27) and returns `202 Accepted`, whatever the payload holds. `202` means only
that the event arrived. Every `4xx` and `5xx` belongs to the platform, such as
authentication, the gateway, or a database that can't store the event, so the
callback never returns one for the content. It doesn't deserialize the payload
into a DTO either, because a malformed body would make Spring answer `400`
before the callback runs. Parsing and validation happen when the inbox is
processed, and an invalid event goes to the dead-letter table (see D27).

## Pagination

**S38. `Pageable` and `Page` start at the query port.** Spring Data's types
appear from the query ports inward, the one exception of S7. Controllers use
`PageableDto` and `PageDto`, and `PageMapper` converts between the two.

**S39. DTOs mirror Spring Data.** `PageableDto` and `PageDto` use the same field
names and types as `Pageable` and `Page`, with OpenAPI annotations added. The
API contract then belongs to the project, because Spring Data doesn't guarantee
a stable JSON form for `Page`. The one difference is `sort`, since Spring's
`Sort` isn't a usable API type: a `SortOrderDto` mirrors `Sort.Order` with
`property` and `direction`. Binding `sort=createdAt,DESC` from a query string
needs a registered `Converter<String, SortOrderDto>`.

```java
@Data
@ParameterObject
public class PageableDto {

    @Parameter(description = "Zero-based page index", example = "0")
    @Min(0)
    private int pageNumber = 0;

    @Parameter(description = "Maximum items per page", example = "20")
    @Min(1)
    @Max(100)
    private int pageSize = 20;

    @Parameter(description = "Sort criteria", example = "createdAt,DESC")
    private List<@Valid SortOrderDto> sort = List.of();

}

@Builder
public record PageDto<T>(@Schema(description = "Items on this page") List<T> content,
    @Schema(description = "Zero-based page index", example = "0") int number,
    @Schema(description = "Requested page size", example = "20") int size,
    @Schema(description = "Items on this page", example = "20") int numberOfElements,
    @Schema(description = "Items across all pages", example = "137") long totalElements,
    @Schema(description = "Total number of pages", example = "7") int totalPages,
    @Schema(description = "Whether this is the first page", example = "true") boolean first,
    @Schema(description = "Whether this is the last page", example = "false") boolean last,
    @Schema(description = "Whether this page has no items", example = "false") boolean empty,
    @Schema(description = "Sort criteria applied to this page") List<SortOrderDto> sort) {}

// Controller: one batched lookup for the owners on this page (see S49)
final Page<ProjectReadModel> projects = projectQueries.findAll(pageMapper.toPageable(pageableDto));
final Set<Long> ownerIds = projects.map(ProjectReadModel::ownerId).toSet();
final Map<Long, UserSummary> usersById = userQueries.findSummaries(ownerIds);

return ResponseEntity.ok(pageMapper.toPageDto(projects.map(project -> projectApiMapper.toReadDto(project, usersById))));
```

`PageMapper` is hand-written, because MapStruct can't generate a mapping for a
generic type variable. Bound `pageSize` so a client can't request an entire
table.

## Error handling

**S40. One consistent error model.**

- All REST exceptions go through a single `@RestControllerAdvice` that extends
  `ResponseEntityExceptionHandler`, so Spring's own 4xx errors stay correct.
- **Domain exceptions know nothing about HTTP** (see D15). Each one extends a
  category in `shared.domain`, says what went wrong in domain terms and carries
  a code (see S41). The advice maps the category to a status, in one exhaustive
  `switch` over the sealed hierarchy:

| Category                         | Meaning                                        | Status |
| -------------------------------- | ---------------------------------------------- | ------ |
| `AggregateNotFoundException`     | The aggregate doesn't exist                    | `404`  |
| `InvalidValueException`          | A value object rejected its input (see D22)    | `400`  |
| `InvalidStateException`          | The current state forbids the action (see D21) | `409`  |
| `BusinessRuleViolationException` | A business rule rejects the action             | `422`  |
| `VersionMismatchException`       | The client's version is stale (see D13)        | `412`  |

- **Adapter exceptions own their status.** Exceptions of the adapters, such as
  `InvalidPatchResultException`, live in `shared.error` and follow the hierarchy
  base exception → client (4xx) or server (5xx) → specific exception.
- Every API returns the same error format, preferably `ProblemDetail` (RFC
  9457).
- Client errors log at `warn` without a stack trace. Server errors log at
  `error` with one.
- 5xx responses never expose internals such as bucket names, keys or parser
  messages.
- **A lost race is a stale version too.** Hibernate checks `@Version` when the
  commit flushes, after the service has returned, and Spring translates the
  failure into `ObjectOptimisticLockingFailureException`. It isn't a domain
  exception, so it needs its own handler, or the client gets a `500` for a
  normal concurrent edit. The handler catches the parent,
  `OptimisticLockingFailureException`, which Spring Data JDBC and MongoDB throw
  too, and answers `412` with the code of `VersionMismatchException`,
  `VERSION_MISMATCH`: either way, the client reads again and retries.
- GraphQL needs its own exception resolver, because REST advice doesn't cover
  it.

```java
// shared.domain
public abstract sealed class DomainException extends RuntimeException
    permits AggregateNotFoundException, InvalidValueException, InvalidStateException,
    BusinessRuleViolationException, VersionMismatchException {

    private final String code;

    protected DomainException(String code, String message) {

        super(message);
        this.code = code;
    }

    public String getCode() {

        return code;
    }

}

// One of the four open categories. VersionMismatchException is final.
public abstract non-sealed class AggregateNotFoundException extends DomainException {

    protected AggregateNotFoundException(String code, String message) {

        super(code, message);
    }

}

/*
 * The one final category: a stale version is the same error for every
 * aggregate, so it has one code, which the optimistic-locking handler reuses.
 */
public final class VersionMismatchException extends DomainException {

    public static final String CODE = "VERSION_MISMATCH";

    public VersionMismatchException(String aggregateType, long expectedVersion) {

        super(CODE, "This %s has changed since version %d. Read it again and repeat your change."
            .formatted(aggregateType.toLowerCase(), expectedVersion));
    }

}

// project.domain
public class ProjectNotFoundException extends AggregateNotFoundException {

    public ProjectNotFoundException(ProjectId projectId) {

        super("PROJECT_NOT_FOUND", "Project %d doesn't exist.".formatted(projectId.value()));
    }

}

// shared.error
@Slf4j
@RestControllerAdvice
class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    @ExceptionHandler
    ResponseEntity<ProblemDetail> handleDomainException(DomainException exception) {

        final HttpStatus status = switch (exception) {
            case AggregateNotFoundException _ -> HttpStatus.NOT_FOUND;
            case InvalidValueException _ -> HttpStatus.BAD_REQUEST;
            case InvalidStateException _ -> HttpStatus.CONFLICT;
            case BusinessRuleViolationException _ -> HttpStatus.UNPROCESSABLE_CONTENT;
            case VersionMismatchException _ -> HttpStatus.PRECONDITION_FAILED;
        };

        log.warn("{}: {}", exception.getCode(), exception.getMessage());

        final ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, exception.getMessage());
        problem.setProperty("code", exception.getCode());

        return ResponseEntity.status(status).body(problem);
    }

    // Commands validate themselves (see S34). Each invalid field gets its own entry (see S42).
    @ExceptionHandler
    ResponseEntity<ProblemDetail> handleInvalidCommand(InvalidCommandException exception) {

        log.warn("Invalid {}: {}", exception.getCommandName(), exception.getViolations());

        return ResponseEntity.badRequest().body(invalidFields(exception.getViolations()));
    }

    // A patched DTO that breaks its constraints (see S33): the same answer as a PUT body.
    @ExceptionHandler
    ResponseEntity<ProblemDetail> handleConstraintViolation(ConstraintViolationException exception) {

        final List<FieldViolation> violations = exception.getConstraintViolations().stream()
                                                         .map(violation -> new FieldViolation(violation.getPropertyPath().toString(),
                                                                                              violation.getMessage()))
                                                         .toList();

        log.warn("Invalid patched request: {}", violations);

        return ResponseEntity.badRequest().body(invalidFields(violations));
    }

    // A request body that breaks its constraints. Spring's default lists no fields (see S42).
    @Override
    protected @Nullable ResponseEntity<Object> handleMethodArgumentNotValid(MethodArgumentNotValidException exception,
        HttpHeaders headers, HttpStatusCode status, WebRequest request) {

        final BindingResult bindingResult = exception.getBindingResult();

        // A class-level constraint names no field, so it's reported against the request.
        final List<FieldViolation> violations = Stream.concat(
            bindingResult.getFieldErrors().stream().map(error -> new FieldViolation(error.getField(), messageOf(error))),
            bindingResult.getGlobalErrors().stream().map(error -> new FieldViolation("request", messageOf(error))))
            .toList();

        log.warn("Invalid request: {}", violations);

        return handleExceptionInternal(exception, invalidFields(violations), headers, HttpStatus.BAD_REQUEST, request);
    }

    /*
     * Another transaction committed between the version check (see D13) and the
     * flush. Same status and code as VersionMismatchException: the client's
     * version is stale either way. The library message goes to the log only.
     */
    @ExceptionHandler
    ResponseEntity<ProblemDetail> handleOptimisticLockingFailure(OptimisticLockingFailureException exception) {

        log.warn("Concurrent update rejected: {}", exception.getMessage());

        final ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.PRECONDITION_FAILED,
            "Someone changed this resource after your last read. Read it again and repeat your change.");
        problem.setProperty("code", VersionMismatchException.CODE);

        return ResponseEntity.status(HttpStatus.PRECONDITION_FAILED).body(problem);
    }

    // A missing If-Match on an update is 428 (RFC 6585), not Spring's default 400.
    @Override
    protected @Nullable ResponseEntity<Object> handleServletRequestBindingException(
        ServletRequestBindingException exception, HttpHeaders headers, HttpStatusCode status,
        WebRequest request) {

        if (exception instanceof MissingRequestHeaderException missingHeader
            && HttpHeaders.IF_MATCH.equalsIgnoreCase(missingHeader.getHeaderName())) {

            final ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.PRECONDITION_REQUIRED,
                "This update needs an If-Match header with the ETag of your last read.");

            return handleExceptionInternal(exception, problem, headers, HttpStatus.PRECONDITION_REQUIRED, request);
        }

        return super.handleServletRequestBindingException(exception, headers, status, request);
    }

    // One body for every invalid input: DTOs, patched DTOs and commands (see S34).
    private ProblemDetail invalidFields(List<FieldViolation> violations) {

        final ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST,
            "Some fields are invalid. Fix them and send the request again.");
        problem.setProperty("errors", violations);

        return problem;
    }

    private String messageOf(ObjectError error) {

        return Objects.requireNonNullElse(error.getDefaultMessage(), "is invalid");
    }

}
```

`HttpStatus.UNPROCESSABLE_CONTENT` is Spring Framework 7's name for `422`.
**On Boot 3** (Spring Framework 6), use `UNPROCESSABLE_ENTITY`.

**S41. Coded domain errors.** Alongside technical errors, document custom domain
errors with examples. Each has a stable, machine-readable code, such as
`PROJECT_ALREADY_ARCHIVED`, returned in the error body as `code`.

**S42. Useful messages, nothing technical.** Every error response, `4xx` and
`5xx` alike, carries a message the client can act on: what went wrong and, where
possible, how to fix it.

- Write the `detail` for the client. "Project 42 is archived and can't be
  renamed" helps. "Invalid state" doesn't.
- Never show anything technical: exception messages from libraries, class names,
  stack traces, SQL, constraint or column names, hostnames, file paths or bucket
  names. Never copy `exception.getMessage()` from a library exception into the
  response.
- Validation errors list each invalid field with its own message.
- A `5xx` response has a generic message plus the trace or correlation
  identifier, so support can find the full error in the logs.
- An error received from a remote system is translated into our own error model,
  never passed through to our client (see S57).

**S43. Bulk operations account for every entry.** A bulk operation either runs
in a single transaction, so it succeeds or fails as a whole, or reports each
entry. When it isn't one transaction:

- Each failed entry is processed independently, so one failure doesn't stop the
  others.
- Each failed entry is logged with its identifier and the reason it failed,
  following the levels in S40. Log identifiers, not whole payloads, so no
  personal data reaches the logs.
- The operation ends with one summary log line: processed, succeeded and failed.
- When the bulk operation is an API call, the response lists the outcome of each
  entry, with the same kind of useful message as S42.

This applies to scheduled jobs as well as to API calls (see S49 and D29).

## Configuration files

**S61. Hierarchical property keys.** A property key is a dot-separated path from
the most general segment to the most specific one: the owner (one of our
features, or a remote system), then the area, then the detail, such as
`carrier.api.shipments-path` or `scheduler.order.cleanup.lock-at-most`. Each
segment is lower-case kebab-case. A value used by several keys is defined once
and referenced with `${…}`, so a base path or a host changes in one place, and
keys under one prefix bind to one `@ConfigurationProperties` record (see S4).
Related keys sit together under a comment heading, such as `### CARRIER ###`.
Spring Boot's own keys, such as `spring.http.serviceclient.*`, keep Spring
Boot's names.

**S62. Endpoint paths live in properties files.** Every controller path is a key
in a properties file under `src/main/resources`, loaded by one `@PropertySource`
configuration class, and each mapping annotation references its key as a single
placeholder: no literal paths and no class-level prefix. Public and internal
APIs are kept apart:

- **Public paths** go in `api-paths.properties`, under `api.`. That file lists
  the whole public contract in one place, and S28 to S30 apply to the resolved
  paths.
- **Internal paths**, such as event callbacks and cluster HTTP RPCs (the
  `@Hidden` endpoints of S37), go in `internal-api-paths.properties`, under
  `internal.api.`. They may use verbs, but they're still listed in one place, so
  the internal surface is reviewed and secured as a whole.

The version prefix composes from one base path, which both files share.

```properties
api.v1.version=v1
api.v1.base-path=/api/${api.v1.version}
### PROJECTS ###
api.v1.projects.path=${api.v1.base-path}/projects
api.v1.projects.id.path=${api.v1.projects.path}/{projectId}
api.v1.projects.id.status.path=${api.v1.projects.id.path}/status
api.v1.projects.id.tasks.path=${api.v1.projects.id.path}/tasks
```

```properties
# internal-api-paths.properties
internal.api.v1.callbacks.path=${api.v1.base-path}/internal/callbacks
internal.api.v1.callbacks.order-paid.path=${internal.api.v1.callbacks.path}/order-paid
```

```java
@Configuration
@PropertySource({"classpath:api-paths.properties", "classpath:internal-api-paths.properties"})
class ApiPathsConfig {
    // Loads the controller paths that the mappings reference as ${…} placeholders.
}

@GetMapping("${api.v1.projects.id.path}")
ResponseEntity<ProjectReadDto> getById(@PathVariable Long projectId);

@PutMapping("${api.v1.projects.id.status.path}")
ResponseEntity<ProjectReadDto> changeStatus(@PathVariable Long projectId,
    @RequestBody @Valid ProjectStatusDto projectStatusDto,
    @RequestHeader(HttpHeaders.IF_MATCH) String ifMatch);

// The raw body, stored as it is: the callback always answers 202 (see S37).
@Hidden
@PostMapping("${internal.api.v1.callbacks.order-paid.path}")
ResponseEntity<Void> onOrderPaid(@RequestBody String payload);
```
