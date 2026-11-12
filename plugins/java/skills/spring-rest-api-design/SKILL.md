---
name: spring-rest-api-design
description: 'Use when adding or changing REST endpoints, request and response DTOs, validation, OpenAPI annotations, pagination or error handling in a project that follows the java-standards opt-in. Covers Richardson level 2, standard HTTP and RFC features, resource naming, PATCH with JSON Merge Patch and JSON Patch, validation split, OpenAPI documentation, PageableDto and PageDto, ProblemDetail errors and bulk operations (rules S26 to S43).'
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
it instead of inventing a field, header or endpoint. Don't introduce custom
`X-` headers when a standard one exists.

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

| Avoid                       | Prefer                       |
| --------------------------- | ---------------------------- |
| `POST /getProjects`         | `GET /projects`              |
| `GET /deleteProject?id=42`  | `DELETE /projects/42`        |
| `POST /projects/42/archive` | `POST /projects/42/archival` |

**S29. Plural collection names.** A path segment that names a collection is
plural, and a single resource is addressed by its identifier inside that
collection. The same plural name serves both, so every resource follows one
pattern.

| Avoid                  | Prefer                   |
| ---------------------- | ------------------------ |
| `GET /project/42`      | `GET /projects/42`       |
| `GET /project/42/task` | `GET /projects/42/tasks` |

**S30. Path variables named after their resource.** A path variable is
named after the resource it identifies, never just `id`, so nested paths stay
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
  media type `application/merge-patch+json`. The client sends only the fields
  it changes, and `null` removes a field. It is the simplest format for clients
  and covers most resources.
- **JSON Patch when the resource needs it.** Use RFC 6902 with
  `application/json-patch+json` when Merge Patch can't express the change:
  editing single array elements, setting a field to `null` instead of removing
  it, or guarding a change with a `test` operation. A resource can accept both
  on the same path, routed by `consumes`.
- **Patch the write DTO, not the entity.** Clients can then reach only writable
  fields.
- **Validate after patching.** Spring validates the request body, which here is
  the patch document, so the patched DTO has to be validated explicitly.
- **Protect against lost updates.** The read and the update run in separate
  transactions (see S9), so require `If-Match` and pass the version down as in
  S8 (see D7).
- **Use the maintained artifact for JSON Patch.** Use
  `io.github.vishwakarma:zjsonpatch`, which is the project's current home and
  supports both Jackson generations through the same Java package: `JsonPatch`
  for Jackson 2 and `Jackson3JsonPatch` for Jackson 3. Its Jackson dependency is
  optional, so declare the one you use. The old
  `com.flipkart.zjsonpatch:zjsonpatch` artifact stopped at 0.4.16 in 2023.

```java
// Controller
@Override
public ResponseEntity<ProjectReadDto> mergePatch(Long projectId, String ifMatch,
    JsonNode mergePatch) {

    ProjectWriteDto current = projectApiMapper.toWriteDto(projectService.findById(projectId));
    ProjectWriteDto patched = patchApplier.applyMergePatch(mergePatch, current, ProjectWriteDto.class);
    Project updatedProject = projectService.update(projectId,
                                                   projectApiMapper.toDomain(patched),
                                                   ETags.toVersion(ifMatch));
    Map<Long, UserSummary> usersById = userService.findSummaries(Set.of(updatedProject.getOwnerId()));

    return ResponseEntity.ok()
                         .eTag(ETags.of(updatedProject.getVersion()))
                         .body(projectApiMapper.toReadDto(updatedProject, usersById));
}

/*
 * shared.web. The Jackson 2 API is shown. On Jackson 3, use JsonMapper and
 * Jackson3JsonPatch, whose exceptions are unchecked.
 */
@Component
@RequiredArgsConstructor
public class PatchApplier {

    private final ObjectMapper objectMapper;

    private final Validator validator;

    public <T> T applyJsonPatch(JsonNode jsonPatch, T source, Class<T> type) {

        JsonNode patched = JsonPatch.apply(jsonPatch, objectMapper.valueToTree(source));

        return readAndValidate(patched, type);
    }

    public <T> T applyMergePatch(JsonNode mergePatch, T source, Class<T> type) {

        JsonNode patched = merge(objectMapper.valueToTree(source), mergePatch);

        return readAndValidate(patched, type);
    }

    // The merge algorithm defined in RFC 7396, section 2.
    private JsonNode merge(JsonNode target, JsonNode patch) {

        if (!patch.isObject()) {
            return patch;
        }

        ObjectNode result = target instanceof ObjectNode objectNode ? objectNode : objectMapper.createObjectNode();

        patch.properties().forEach(entry -> {
            if (entry.getValue().isNull()) {
                result.remove(entry.getKey());
            } else {
                result.set(entry.getKey(), merge(result.path(entry.getKey()), entry.getValue()));
            }
        });

        return result;
    }

    private <T> T readAndValidate(JsonNode patched, Class<T> type) {

        T result = read(patched, type);
        Set<ConstraintViolation<T>> violations = validator.validate(result);

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

        try {
            return objectMapper.readerFor(type)
                               .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
                               .treeToValue(patched, type);
        } catch (JsonProcessingException exception) {
            throw new InvalidPatchResultException(exception);
        }
    }

}
```

Failures map to these statuses, following RFC 5789:

| Failure                       | Exception                       | Status |
| ----------------------------- | ------------------------------- | ------ |
| Malformed JSON in the request | Handled by Spring               | `400`  |
| Invalid JSON Patch document   | `InvalidJsonPatchException`     | `400`  |
| Wrong media type              | Handled by Spring               | `415`  |
| Failed `test` operation       | `JsonPatchTestFailedException`  | `409`  |
| Patch can't be applied        | `JsonPatchApplicationException` | `422`  |
| Patched result has bad fields | `InvalidPatchResultException`   | `422`  |
| Patched result fails rules    | `ConstraintViolationException`  | `422`  |

## REST validation

**S34. DTOs validate shape, the domain validates rules.** Each rule lives in
one place.

- **DTOs** check what a request looks like: required fields, lengths, formats,
  ranges and patterns. A violation returns `400`. Use Jakarta Validation
  annotations, and create a custom annotation when the standard ones can't
  express the check. Use validation groups (`OnCreate`, `OnUpdate`) when rules
  differ by operation.
- **The domain** enforces business invariants, such as allowed state
  transitions or a uniqueness that depends on other data. A violation throws a
  coded domain error (see S41), usually returned as `409` or `422`.

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
reachable,
so it needs its own access control.

## Pagination

**S38. `Pageable` and `Page` start at the service.** Spring Data's types live in
the service layer and below. Controllers use `PageableDto` and `PageDto`, and
`PageMapper` converts between the two.

**S39. DTOs mirror Spring Data.** `PageableDto` and `PageDto` use the same field
names and types as `Pageable` and `Page`, with OpenAPI annotations added. The
API
contract then belongs to the project, because Spring Data doesn't guarantee a
stable JSON form for `Page`. The one difference is `sort`, since Spring's `Sort`
isn't a usable API type: a `SortOrderDto` mirrors `Sort.Order` with `property`
and
`direction`. Binding `sort=createdAt,DESC` from a query string needs a
registered
`Converter<String, SortOrderDto>`.

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

@Value
@Builder
public class PageDto<T> {

    @Schema(description = "Items on this page")
    List<T> content;

    @Schema(description = "Zero-based page index", example = "0")
    int number;

    @Schema(description = "Requested page size", example = "20")
    int size;

    @Schema(description = "Items on this page", example = "20")
    int numberOfElements;

    @Schema(description = "Items across all pages", example = "137")
    long totalElements;

    @Schema(description = "Total number of pages", example = "7")
    int totalPages;

    @Schema(description = "Whether this is the first page", example = "true")
    boolean first;

    @Schema(description = "Whether this is the last page", example = "false")
    boolean last;

    @Schema(description = "Whether this page has no items", example = "false")
    boolean empty;

    @Schema(description = "Sort criteria applied to this page")
    List<SortOrderDto> sort;

}

// Controller: one batched lookup for the owners on this page (see S49)
Page<Project> projects = projectService.findAll(pageMapper.toPageable(pageableDto));
Set<Long> ownerIds = projects.map(Project::getOwnerId).toSet();
Map<Long, UserSummary> usersById = userService.findSummaries(ownerIds);

return ResponseEntity.ok(pageMapper.toPageDto(projects.map(project -> projectApiMapper.toReadDto(project, usersById))));
```

`PageMapper` is hand-written, because MapStruct can't generate a mapping for a
generic type variable. Bound `pageSize` so a client can't request an entire
table.

## Error handling

**S40. One consistent error model.**

- All REST exceptions go through a single `@RestControllerAdvice` that extends
  `ResponseEntityExceptionHandler`, so Spring's own 4xx errors stay correct.
- The hierarchy is base exception → client (4xx) or server (5xx) → specific
  exception, and each exception owns its HTTP status.
- Every API returns the same error format, preferably `ProblemDetail` (RFC
  9457).
- Client errors log at `warn` without a stack trace. Server errors log at
  `error` with one.
- 5xx responses never expose internals such as bucket names, keys or parser
  messages.
- GraphQL needs its own exception resolver, because REST advice doesn't cover
  it.

**S41. Coded domain errors.** Alongside technical errors, document custom domain
errors with examples. Each has a stable, machine-readable code, such as
`PROJECT_ALREADY_ARCHIVED`, returned in the error body.

**S42. Useful messages, nothing technical.** Every error response, `4xx` and
`5xx` alike, carries a message the client can act on: what went wrong and, where
possible, how to fix it.

- Write the `detail` for the client. "Project 42 is archived and can't be
  renamed" helps. "Invalid state" doesn't.
- Never show anything technical: exception messages from libraries, class
  names, stack traces, SQL, constraint or column names, hostnames, file paths or
  bucket names. Never copy `exception.getMessage()` from a library exception into
  the response.
- Validation errors list each invalid field with its own message.
- A `5xx` response has a generic message plus the trace or correlation
  identifier, so support can find the full error in the logs.
- An error received from a remote system is translated into our own error
  model, never passed through to our client (see S57).

**S43. Bulk operations account for every entry.** A bulk operation either runs
in a single transaction, so it succeeds or fails as a whole, or reports each
entry. When it isn't one transaction:

- Each failed entry is processed independently, so one failure doesn't stop the
  others.
- Each failed entry is logged with its identifier and the reason it failed,
  following the levels in S40. Log identifiers, not whole payloads, so no
  personal data reaches the logs.
- The operation ends with one summary log line: processed, succeeded and
  failed.
- When the bulk operation is an API call, the response lists the outcome of
  each entry, with the same kind of useful message as S42.

This applies to scheduled jobs as well as to API calls (see S49 and D11).
