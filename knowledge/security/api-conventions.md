# API conventions

The parts of API design that decide whether an endpoint can be abused. Naming, casing and versioning are left out: they matter to clients, not to an attacker. The checks are in [access-control](protocols/access-control.md), [injection-and-output](protocols/injection-and-output.md) and [resource-limits](protocols/resource-limits.md).

## Status codes that do not leak

401 means not authenticated and 403 means a function the caller's role may not use. A record that exists but belongs to another account answers 404, everywhere, exactly as a record that does not exist, so the status code never confirms which identifiers are real. 422 is valid syntax with invalid content, 429 is a rate limit, and 500 is a server fault whose details the client never learns. A 200 carrying `{ "success": false }` hides failures from every monitor that reads status codes.

## One error envelope

Every error has the same shape, `{ error: { code, message, fields, requestId } }`: a stable code a client can switch on, a message for people, per-field details for validation, and a request identifier the caller can quote to support. Internal identifiers, table names, query text and stack traces never appear in it; they stay in the server log under the same request identifier.

## Identifiers

Identifiers exposed to callers are opaque. A sequential integer lets anyone enumerate records and count them. An opaque identifier is not an authorization check: every read and write still checks the caller against the record.

## Input

Every input is parsed on the server into a typed shape with an allowlist schema, which says what is accepted rather than what is banned. The first violation is rejected with 400 or 422 and a message naming the field, not the internals. Unknown query parameters are rejected rather than silently ignored.

Writes accept an allowlist of fields. The whole body is never passed to an update, because that lets a caller set a role, an owner or a price. Filtering and sorting are explicit parameters with an allowlist of fields, which also keeps sorts on unindexed columns out.

## Output

A response returns the fields the view uses and none more. A query that selects every column leaks by carelessness the day a sensitive column is added.

## Bounds

Every list is bounded: a documented maximum `limit`, a capped body size and capped array lengths. Pagination is by cursor, `?limit=50&cursor=...` returning the data and the next cursor, rather than by offset, which skips and repeats rows and makes large offsets expensive.

A rate limit answers 429 with `Retry-After`, and the `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` headers let well-behaved clients back off before failing.

## Credentials on requests

Authentication travels as a bearer token in the `Authorization` header or in the session cookie, scoped to what the caller may do, such as read, write or admin. Secrets and personal data never go in a URL, and tokens only as [sessions-and-credentials.md](sessions-and-credentials.md#tokens-in-urls) allows, because URLs end up in logs, histories and referrer headers.

## Idempotency

Anything that creates a record or charges money accepts an `Idempotency-Key` header, so a retry returns the first result instead of acting twice. The rule stands on its own merits:

- The key is scoped to the caller's account, so two accounts cannot collide or read each other's stored response.
- It is stored with a fingerprint of the request body and the response, for the period in [essentials.md](essentials.md#default-values), which is published with the API.
- The same key with another body answers 422, a key whose first request is still running answers 409, and a missing key on an operation that requires one answers 400.
- A replayed response is marked as a replay in a header.

Clients retry only the calls documented as safe to retry, with exponential backoff and jitter.

## Webhooks the service emits

Outgoing webhooks are signed over `id.timestamp.body` with a secret per receiver, carry the event identifier, the timestamp and the signature as headers, and are delivered at least once with retries and backoff, at the values in [essentials.md](essentials.md#default-values). The receiving side is expected to treat them as idempotent. The check is in [outbound-requests](protocols/outbound-requests.md).

## A description that cannot drift

The API is described in one machine-readable file, from which the documentation and the clients are generated. The same file is the inventory the access-control matrix is built from, so an endpoint missing from it is an endpoint nobody tested.
