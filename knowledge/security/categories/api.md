# API

The endpoints a caller can reach: routes, API handlers, server actions, server functions, jobs and subscriptions. The first failure on the API list is here because it scales: one endpoint, every record.

## Endpoint inventory

**Applies when:** an audit starts; a route, handler, server action or job is added; an API description file changes; a version of the API is retired.

**Options:**

- **Inventory from the source.** The default. Route and handler definitions searched in the code describe the reachable surface.
- **Inventory from a machine-readable API description, compared against the source.** When one exists. The difference between the two is the list of endpoints nobody documented and nobody tested.

**Open:** step 1 of [access-control](../protocols/access-control.md); [api-conventions.md](../api-conventions.md#a-description-that-cannot-drift).

## Authorization per object and per function

**Applies when:** an endpoint reads an identifier from the path, the query or the body; an administrative or privileged endpoint is added; a role changes; a check lives in middleware or on the page that renders a form.

**Options:**

- **The check inside the handler, in its first statements.** The default. Middleware and pages are conveniences that have been bypassed, per [framework-traps.md](../framework-traps.md).
- **A policy layer called by every handler.** When roles and ownership rules are many. The handler still calls it; a layer nobody calls is not a check.
- **Opaque identifiers.** They stop enumeration, not access. Every read and write still checks the caller against the record, and a record belonging to someone else answers 404 when its existence matters.

**Open:** steps 2, 3, 5 and 7 of [access-control](../protocols/access-control.md); [api-conventions.md](../api-conventions.md#status-codes-that-do-not-leak).

## Identity taken from the request

**Applies when:** a handler reads a user identifier, an account identifier or a role from the body, the query, the path or a header.

**Options:**

- **Identity from the session or the verified token only.** The only option. Nothing in the request decides who the caller is.

**Open:** step 6 of [access-control](../protocols/access-control.md); [sessions-and-credentials.md](../sessions-and-credentials.md#identity-comes-from-the-session).

## Fields a caller can write or read

**Applies when:** an update accepts a body; a response serializes a record; a column is added to a table that an endpoint returns.

**Options:**

- **Allowlist of writable fields per role.** The default. The whole body is never passed to an update.
- **Explicit response shape per view.** The response returns the fields the view uses and none more, rather than every column.

**Open:** step 4 of [access-control](../protocols/access-control.md); [api-conventions.md](../api-conventions.md#output).

## Input validation

**Applies when:** a handler reads a body, a query parameter, a header or a path segment; a schema changes; a field without a length limit appears.

**Options:**

- **Allowlist schema at the boundary, on the server.** The default. Typed parsing with limits on body size, field length and array length, rejecting unknown parameters.
- **Normalize and validate before storing, not only before rendering.** Always, so a stored value cannot become an injection the day a new template forgets to escape it.

**Open:** steps 1 and 7 of [injection-and-output](../protocols/injection-and-output.md); [api-conventions.md](../api-conventions.md#input).

## Rate limits and resource consumption

**Applies when:** a public endpoint, a search, an export, a batch job or a paid call is added; pagination changes; a business flow with value at the end is built.

**Options:**

- **Limit per account and per address, with backoff.** The default for anything a stranger can reach. Answers 429 with `Retry-After`.
- **Limit per API key.** For machine callers. The key is scoped, and the limit rides on the key rather than the address.
- **Limit per business flow across accounts.** For registration, invitation, reset mail, checkout, voucher redemption and export, where a normal rate from many accounts is the abuse.
- **Cursor pagination with a capped `limit`.** Rather than offsets, which grow expensive and skip rows.

**Open:** [resource-limits](../protocols/resource-limits.md); [api-conventions.md](../api-conventions.md#bounds).

## Idempotency and retries

**Applies when:** an endpoint creates a record, sends a message or charges money; a client retries on timeout.

**Options:**

- **Idempotency key stored with the response.** For creates and charges. The same key returns the same result for 24 hours.
- **Natural uniqueness in the store.** When the record has a real unique key, a constraint makes the second write fail instead of duplicating.

**Open:** [api-conventions.md](../api-conventions.md#idempotency); step 4 of [payments-and-webhooks](../protocols/payments-and-webhooks.md) for money.
