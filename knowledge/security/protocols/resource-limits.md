name: resource-limits
purpose: Prove every entry point has a ceiling and that reaching it costs the caller, not the service.
scope: public endpoints, searches, exports, pagination, batch jobs, metered calls and business flows with value at the end
trigger: task close when the closed work matches the scope, or manual
repeat: once per audit, and again whenever a public endpoint or a metered call is added
inputs: the route table, the rate limit configuration, the billing or quota console, a request client
stop: a ceiling is found only by exceeding it, in which case the test stops at the ceiling and the rest is inferred, never driven further
report: the limit and the response at the limit per endpoint, the pagination ceilings, the body and time limits, the spend cap with the behaviour at the cap, and the business flow limits

## Steps

1. Put a limit on every entry point, keyed on something the caller cannot change freely.
   Task: record the limit per endpoint and what it is keyed on: the account, the address, the API key, or a combination. Authentication, password reset and every expensive call are keyed on both the address and the account, and repeated hits back off rather than resetting. An unauthenticated endpoint keyed only on the address is recorded as such, since addresses are cheap. Behind a proxy, the address is read with the number of trusted hops configured, never from the first value of a forwarding header the caller can set.
   Time: 30 minutes. Repository, plus the limiter configuration.
   Result: one line per endpoint with its limit, its window and its key, and one request carrying a forged forwarding header showing the limit still counts it against the real address. An endpoint with no row is a finding. Unauthenticated forms that send mail or cost money also carry bot protection proportional to the risk, recorded by name.

2. Find each ceiling by reaching it, and stop there.
   Task: drive requests until the limit engages, then stop. Per [rules-of-engagement.md](../rules-of-engagement.md), the ceiling and the response at it are the evidence; going past it is an attack on the service.
   Time: 40 minutes. Running application.
   Result: per endpoint, the request count at which the limit engaged, the status code returned, and the `Retry-After` value where one is sent. A limit that degrades the service before it engages is a finding.

3. Bound every query the caller can shape.
   Task: send an unbounded page size, a negative one, a very large offset, a sort on an unindexed column and a search term that matches everything.
   Time: 30 minutes. Running application.
   Result: the maximum page size enforced server-side with its value, recorded as the response to an oversized request; the response time for the worst case measured; and the cost-heavy sorts restricted to the allowlist from [injection-and-output](injection-and-output.md).

4. Bound the request itself.
   Task: set and test a maximum body size, a header size limit, a request timeout and a limit on concurrent connections, per caller where the server offers it and globally where it does not, with the values in [essentials.md](../essentials.md). Send an oversized body, a slow body, and a request that never completes.
   Time: 30 minutes. Running application.
   Result: the status code for the oversized body received by the client, with nothing past the limit buffered or processed, and the timeout value observed on the slow request rather than read from a configuration file. Limiter state kept in one process's memory is recorded as holding only while one instance runs.

5. Cap spend so that the cap halts the work.
   Task: for every metered or paid call, set a token, request and currency ceiling per account and for the service as a whole, and make reaching it stop the work. A cap that raises an alert and keeps spending is not a cap.
   Time: 40 minutes. Running application, plus the provider quota settings.
   Result: the configured ceilings with their values, and a test run against a deliberately low ceiling showing the work stopped at the limit with the status code returned to the caller and the spend recorded at the provider. **Needs a person**: what the ceiling should be, and who is told when it is hit, are decisions.

6. Put a limit on the business flow, not only on the endpoint.
   Task: the flows worth abusing are the ones with value at the end: registration, invitation, reset mail, checkout, voucher redemption, export. A limit per endpoint does not stop a flow driven at a normal rate from many accounts.
   Time: 30 minutes. Running application.
   Result: per flow, the limit that applies across accounts or addresses, and the observed response when it engages. A flow with only a per-request limit is recorded as a finding with the value it protects named.
