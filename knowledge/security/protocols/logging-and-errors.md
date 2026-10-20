name: logging-and-errors
purpose: Prove failures close, records carry no secrets, and an attack in progress raises something.
scope: exception handlers, error responses, log statements and sinks, alert rules and retention settings
trigger: task close
repeat: once
inputs: the source tree, the log sink, the alert rules, the running application
stop: an exception path continues as though the operation succeeded, which is reported at once and ends the protocol
report: the empty-catch search, the response body on each error class, the security events present in the sink, the secret search over the logs, and the alert that fired during the test

## Steps

1. Make every failure decide.
   Task: search for handlers that swallow an exception: `git grep -n -I -E 'catch *(\([^)]*\))? *\{ *\}|except[^:]*: *pass|rescue *=> *nil'`, with a planted `catch (e) {}` as the positive control, and read the blocks of `git grep -n -I -A 4 -E 'catch *(\([^)]*\))? *\{|except[^:]*:'` for a caught error that is logged and then returns a success value. Mishandling of exceptional conditions entered the OWASP Top 10:2025 as A10 because this pattern turns a failed check into a passed one.
   Time: 40 minutes. Repository.
   Result: zero empty catches and zero catches that return a success value, or each survivor with a file and line reference and the reason the failure is genuinely recoverable there.

2. Prove the closed default at the boundary.
   Task: force each failure class against the running application: a store that is unreachable, a dependency that times out, a malformed body, an expired token, a missing permission.
   Time: 40 minutes. Running application.
   Result: one line per case with the status code and the response body. No case returns 2xx, and no case falls back to an unauthenticated or unlimited path.

3. Keep the internals out of the response.
   Task: read the response body on each case from step 2, and on a deliberately raised server error, in the production configuration rather than the development one.
   Time: 20 minutes. Running application.
   Result: no stack trace, no file path, no query text, no dependency version and no framework banner in any response body, with the bodies quoted, and the error identifier of [api-conventions.md](../api-conventions.md#one-error-envelope) present.

4. Record the events that matter.
   Task: confirm the sink holds an entry for each of: successful and failed authentication, logout, password change and reset, a second factor added or removed, access denial, input validation failure, role or privilege change, administrative action, and rate limit engagement. A09:2025 of the OWASP Top 10 names alerting beside logging, so an event with no rule attached is half the control.
   Time: 40 minutes. Running application, with a read of the log sink.
   Result: one line per event type quoting the entry as stored, with a timestamp, the actor, the source address and the outcome. Where the only actor is an address a stranger typed, such as a failed login for an unknown account, a keyed hash of it stands for the actor. A missing event type is a finding.

5. Keep secrets and personal data out of the records.
   Task: search the log-writing code: `git grep -n -I -i -E '(console|logger|log)\.[a-z]+\([^)]*(password|token|secret|authorization|cookie|card|req\.body|request\.body)'`, with a planted `logger.info(req.body)` as the positive control. Search the sink, printing counts only: `git grep --no-index -c -I -E 'eyJ[A-Za-z0-9_-]{10,}\.|Bearer [A-Za-z0-9._-]{20,}|sk_live_|BEGIN [A-Z ]*PRIVATE KEY' -- <log folder>`, with a planted `Bearer` line in a scratch file as the positive control, and the card expression of step 6 of [payments-and-webhooks](payments-and-webhooks.md). A sink held by a hosted service is searched in its own console with the same expressions. Redaction happens at the point of writing, not in a later filter.
   Time: 30 minutes. Repository, plus a search over the sink.
   Result: zero hits for each expression, with the expressions and controls recorded. A request body logged in full at any level is a finding, because the level changes and the sink does not. Mail captured in development, which carries reset and verification links, goes to its own sink and never through the application logger.

6. Make an attack raise something.
   Task: run one of the bounded tests from an earlier protocol, such as the failed login sequence of step 4 of [authentication-and-session](authentication-and-session.md), and watch whether an alert fires and where it lands.
   Time: 30 minutes. Running application, plus the alerting configuration.
   Result: the alert as delivered, with the time between the test and the delivery. Needs a person: who receives it, and what threshold is worth waking someone for.

7. Set retention and protect the records.
   Task: record the retention period, whether the sink is append-only for the application's own account, who can read it, and whether clocks are synchronised across the services writing to it.
   Time: 20 minutes. Log sink configuration.
   Result: the retention period in days, the application account's grants on the sink showing no delete or rewrite right, the list of accounts with read access, and the clock offset measured between two writers.
