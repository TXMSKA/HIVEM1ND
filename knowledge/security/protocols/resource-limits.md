name: resource-limits
purpose: Prove every entry point has a ceiling and that reaching it costs the caller, not the service.
scope: public endpoints, searches, exports, pagination, batch jobs, metered calls and business flows with value at the end
trigger: task close
repeat: once
inputs: the route table, the rate limit configuration, the billing or quota settings read by the person, a request client
stop: the service degrades before a limit engages, which ends the test at once and is the finding
report: the limit and the response at the limit per endpoint, the pagination ceilings, the body and time limits, the spend cap with the behaviour at the cap, and the business flow limits

Every test that drives requests stops at the first refusal, per [rules-of-engagement.md](../rules-of-engagement.md#what-a-pass-may-never-do).

## Steps

1. Put a limit on every entry point, keyed on something the caller cannot change freely.
   Task: record the limit per endpoint and what it is keyed on: the account, the address, the API key, or a combination. Authentication, password reset and every expensive call are keyed on both the address and the account, and repeated hits back off rather than resetting. Behind a proxy, the address is read with the number of trusted hops configured, never from the first value of a forwarding header the caller can set.
   Time: 30 minutes. Repository, plus the limiter configuration.
   Result: one line per endpoint with its limit, its window and its key, and one request carrying a forged forwarding header showing the limit still counting it against the real address. An endpoint with no line is a finding. Unauthenticated forms that send mail or cost money also carry bot protection proportional to the risk, recorded by name.

2. Find each ceiling by reaching it.
   Task: send requests until the limit engages, and stop at the first refusal.
   Time: 40 minutes. Running application.
   Result: per endpoint, the request count at which the limit engaged, the status code returned, and the `Retry-After` value where one is sent.

3. Bound every query the caller can shape.
   Task: send an unbounded page size, a negative one, a very large offset, a sort on an unindexed column and a search term that matches everything.
   Time: 30 minutes. Running application.
   Result: the maximum page size enforced on the server with its value, recorded as the response to an oversized request; the response time for the worst case measured; and the cost-heavy sorts restricted to the allowlist of step 2 of [injection-and-output](injection-and-output.md).

4. Bound the request itself.
   Task: read the maximum body size, the header size limit, the request timeout and the limit on concurrent connections, per caller where the server offers it and globally where it does not, against [essentials.md](../essentials.md#default-values). Send an oversized body, a slow body, and a request that never completes.
   Time: 30 minutes. Running application.
   Result: the status code for the oversized body received by the client, with nothing past the limit buffered or processed, and the timeout observed on the slow request rather than read from a configuration file. Limiter state kept in one process's memory is recorded as holding only while one instance runs.

5. Cap spend so that the cap halts the work.
   Task: for every metered or paid call, read the token, request and currency ceiling per account and for the service as a whole, in the application and, through the person, at the provider. Proving that reaching it stops the work needs a deliberately low ceiling: on a test build whose ceiling is lowered through its configuration, or as a fixture per [rules-of-engagement.md](../rules-of-engagement.md#test-fixtures). A cap that raises an alert and keeps spending is not a cap.
   Time: 40 minutes. Running application.
   Result: the configured ceilings with their values, and the run against the low ceiling stopped at the limit with the status code returned to the caller; without such a build or fixture, that run is not run. Needs a person: what the ceiling should be, and who is told when it is hit.

6. Put a limit on the business flow, not only on the endpoint.
   Task: the flows worth abusing are the ones with value at the end: registration, invitation, reset mail, checkout, voucher redemption, export. A limit per endpoint does not stop a flow driven at a normal rate from many accounts; the same value spent twice at once is [business-logic](business-logic.md).
   Time: 30 minutes. Running application.
   Result: per flow, the limit that applies across accounts or addresses, and the observed response when it engages. A flow with only a per-request limit is a finding, with the value it protects named.
