# Logging and errors

How the application behaves when something fails, what it tells the caller, what it writes down, and whether an attack in progress raises anything.

## Failure handling

**Applies when:** a try and catch, an error boundary, a fallback or a retry is added; a dependency call can fail; a check can throw.

**Options:**

- **Fail closed.** The default. A failed check denies, and a caught error never falls through to the success path.
- **Recover explicitly.** Only where the failure is genuinely recoverable, with the reason written beside the handler.

**Open:** steps 1 and 2 of [logging-and-errors](../protocols/logging-and-errors.md).

## Error responses

**Applies when:** an error handler, an error page or an API error shape changes; production and development configurations differ.

**Options:**

- **A stable code and a request identifier for the caller, the details in the server log.** The default.
- **One error envelope for every endpoint.** Per [api-conventions.md](../api-conventions.md#one-error-envelope).

**Open:** step 3 of [logging-and-errors](../protocols/logging-and-errors.md).

## Security events and alerts

**Applies when:** authentication, authorization, privilege, administrative or rate limit behaviour changes; an alert rule is added.

**Options:**

- **Every security event written with time, actor, address and outcome.** The default.
- **Alerts on the events worth waking someone for.** Who receives them and at what threshold is a person's decision.

**Open:** steps 4 and 6 of [logging-and-errors](../protocols/logging-and-errors.md).

## Secrets and personal data in records

**Applies when:** a log statement, an error reporter or a request logger is added; a log level changes.

**Options:**

- **Redaction at the point of writing.** The default, never a later filter.
- **Log identifiers, never bodies.** Full request bodies are never logged at any level, because the level changes and the sink does not.

**Open:** step 5 of [logging-and-errors](../protocols/logging-and-errors.md); [configuration.md](../configuration.md#logs).

## Retention and protection

**Applies when:** a log sink, its retention or its access list changes.

**Options:**

- **Append-only for the application's own account, read access restricted, clocks synchronised.** The default.
- **Retention period.** A person's decision, recorded in days.

**Open:** step 7 of [logging-and-errors](../protocols/logging-and-errors.md).
