# API

The endpoints a caller can reach: routes, API handlers, server actions, server functions, jobs and subscriptions. The first failure on the API list is here because it scales: one endpoint, every record.

## Endpoint inventory

Applies when: an audit starts; a route, handler, server action or job is added; an API description file changes; a version of the API is retired.

Build: Declare every route in one table with its method, handler and access rule, such as public, session, role or webhook. The boot fails on a route without a rule, an unmatched path answers 404 and an unknown method 405.

Options:

- **Inventory from the source.** The default. Route and handler definitions searched in the code describe the reachable surface.
- **Inventory from a machine-readable API description, compared against the source.** When one exists. The difference between the two is the list of endpoints nobody documented and nobody tested.

Open: step 1 of [access-control](../protocols/access-control.md); [api-conventions.md](../api-conventions.md#a-description-that-cannot-drift).

## Authorization per object and per function

Applies when: an endpoint reads an identifier from the path, the query or the body; an administrative or privileged endpoint is added; a role changes; a check lives in middleware or on the page that renders a form.

Build: Every query for an owned record carries the owner column taken from the session in its condition, so another account's record is simply not found and answers as [api-conventions.md](../api-conventions.md#status-codes-that-do-not-leak) sets out. Privileged handlers check the role in their first statement.

Options:

- **The check inside the handler, in its first statements.** The default. Middleware and pages are conveniences that have been bypassed, per [framework-traps.md](../framework-traps.md).
- **A policy layer called by every handler.** When roles and ownership rules are many. The handler still calls it; a layer nobody calls is not a check.
- **Opaque identifiers.** They stop enumeration, not access; every read and write still checks the caller against the record.

Open: steps 2, 3, 5 and 7 of [access-control](../protocols/access-control.md).

## Identity taken from the request

Applies when: a handler reads a user identifier, an account identifier or a role from the body, the query, the path or a header.

Build: Handlers read the account and the role from the session object only. A body field naming an account, an owner or a role is an unknown field and is refused.

Options:

- **Identity from the session or the verified token only.** The only option.

Open: step 6 of [access-control](../protocols/access-control.md); [sessions-and-credentials.md](../sessions-and-credentials.md#identity-comes-from-the-session).

## Fields a caller can write or read

Applies when: an update accepts a body; a response serializes a record; a column is added to a table that an endpoint returns.

Build: Keep one allowlist of writable fields per role and one view function per response shape. The stored record, with its password hash, internal flags and foreign keys, is never sent as it is.

Options:

- **Allowlist of writable fields per role.** The default. The whole body is never passed to an update.
- **Explicit response shape per view.** The response returns the fields the view uses and none more.

Open: step 4 of [access-control](../protocols/access-control.md); [api-conventions.md](../api-conventions.md#output).

## Input validation

Applies when: a handler reads a body, a query parameter, a header or a path segment; a schema changes; a field without a length limit appears; a request value reaches a mail header or address.

Build: Give each handler a schema with types, length caps and array caps that refuses unknown fields and parameters with 400 or 422, refuses an unexpected content type with 415, refuses a line break in any value bound for a header, and caps the body at the size in [essentials.md](../essentials.md#default-values) with 413.

Options:

- **Allowlist schema at the boundary, on the server.** The default.
- **Normalize and validate before storing, not only before rendering.** Always, so a stored value cannot become an injection the day a new template forgets to escape it.

Open: steps 1, 7 and 8 of [injection-and-output](../protocols/injection-and-output.md); [api-conventions.md](../api-conventions.md#input).

## Business logic and concurrency

Applies when: a handler redeems, consumes or transfers a voucher, a credit, a balance, stock, a seat, a quota or an invitation; a flow takes more than one request; a handler reads a record and then writes it.

Build: Spend every bounded value with one conditional update from the expected state, or behind a unique constraint, inside one transaction, and keep the state of a multi-step flow on the server so each step checks the one before it.

Options:

- **Conditional update.** The default: the write names the expected state, and zero rows changed means the value was already spent.
- **Unique constraint.** When each spend leaves a row, such as one redemption per voucher and account.
- **Row lock.** When the decision needs several reads; held for the shortest transaction.

Open: [business-logic](../protocols/business-logic.md); step 6 of [resource-limits](../protocols/resource-limits.md) for flows driven from many accounts.

## Rate limits and resource consumption

Applies when: a public endpoint, a search, an export, a batch job or a paid call is added; pagination changes; a business flow with value at the end is built.

Build: Put a limiter keyed on the address and the account in front of every public entry point and every business flow, answering 429 with `Retry-After`. The client address is read with the configured trusted hops, and the limiter state lives in a shared store once more than one instance runs.

Options:

- **Limit per account and per address, with backoff.** The default for anything a stranger can reach.
- **Limit per API key.** For machine callers. The key is scoped, and the limit rides on the key rather than the address.
- **Limit per business flow across accounts.** For registration, invitation, reset mail, checkout, voucher redemption and export.
- **Cursor pagination with a capped `limit`.** Rather than offsets, which grow expensive and skip rows.

Open: [resource-limits](../protocols/resource-limits.md); [api-conventions.md](../api-conventions.md#bounds).

## Idempotency and retries

Applies when: an endpoint creates a record, sends a message or charges money; a client retries on timeout.

Build: Accept an `Idempotency-Key` on creates and charges, built as [api-conventions.md](../api-conventions.md#idempotency) sets out.

Options:

- **Idempotency key stored with the response.** For creates and charges.
- **Natural uniqueness in the store.** When the record has a real unique key, a constraint makes the second write fail instead of duplicating.

Open: [api-conventions.md](../api-conventions.md#idempotency); step 4 of [payments-and-webhooks](../protocols/payments-and-webhooks.md) for money.
