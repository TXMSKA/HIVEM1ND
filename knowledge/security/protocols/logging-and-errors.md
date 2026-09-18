name: logging-and-errors
purpose: Prove failures close, records carry no secrets, and an attack in progress raises something.
scope: exception handlers, error responses, log statements and sinks, alert rules and retention settings
trigger: task close when the closed work matches the scope, or manual
repeat: once per audit, and again whenever a handler, a log sink or an alert rule changes
inputs: the source tree, the log sink, the alert rules, the running application
stop: an exception path continues as though the operation succeeded, which is reported before the pass continues
report: the empty-catch search, the response body on each error class, the security events present in the sink, the secret search over the logs, and the alert that fired during the test

## Steps

1. Make every failure decide.
   Task: search for handlers that swallow an exception and continue, for ignored return values on operations that can fail, and for a caught error that is logged and then falls through to the success path. Mishandling of exceptional conditions entered the current application list in its own right precisely because this pattern turns a failed check into a passed one.
   Time: 40 minutes. Repository.
   Result: zero hits for an empty catch and for a catch that returns a success value, or each survivor with a file and line reference and the reason the failure is genuinely recoverable there.

2. Prove the closed default at the boundary.
   Task: force each failure class against the running application: a store that is unreachable, a dependency that times out, a malformed body, an expired token, a missing permission.
   Time: 40 minutes. Running application.
   Result: one line per case with the status code and the response body. No case returns 2xx, and no case falls back to an unauthenticated or unlimited path.

3. Keep the internals out of the response.
   Task: read the response body on each case from step 2, and on a deliberately raised server error, in the production configuration rather than the development one.
   Time: 20 minutes. Running application.
   Result: no stack trace, no file path, no query text, no dependency version and no framework banner in any response body, with the bodies quoted. An error identifier the caller can quote to support is recorded as present or absent.

4. Record the events that matter.
   Task: confirm the sink actually holds an entry for each of: failed authentication, successful authentication, password change, access denial, input validation failure, privilege change, administrative action, and rate limit engagement. The current list names alerting alongside logging, so an event with no rule attached is only half the control.
   Time: 40 minutes. Running application, with a read of the log sink.
   Result: one line per event type quoting the entry as stored, with a timestamp, the actor, the source address and the outcome, enough to reconstruct an incident from the sink alone. A missing event type is a finding.

5. Keep secrets and personal data out of the records.
   Task: search the log sink and the log-writing code for tokens, passwords, keys, card numbers, full personal data, full request bodies and identity documents. Redaction happens at the point of writing, not in a later filter.
   Time: 30 minutes. Repository, plus a search over the sink.
   Result: zero hits for each pattern searched, with the search expressions recorded. A request body logged in full at any level is a finding, because the level changes and the sink does not.

6. Make an attack raise something.
   Task: run one of the bounded tests from an earlier protocol, such as the failed login sequence or the rate limit test, and watch whether an alert fires and where it lands.
   Time: 30 minutes. Running application, plus the alerting configuration.
   Result: the alert as delivered, with the time between the test and the delivery. **Needs a person**: who is on the receiving end, and what threshold is worth waking someone for, are decisions.

7. Set retention and protect the records.
   Task: record the retention period, whether the sink is append-only for the application's own account, who can read it, and whether clocks are synchronised across the services writing to it.
   Time: 20 minutes. Log sink configuration.
   Result: the retention period in days, the application account's grants on the sink showing no delete or rewrite right, the list of accounts with read access, and the clock offset measured between two writers.
