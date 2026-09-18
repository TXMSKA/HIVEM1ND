# Rules of engagement

A security pass tests one application: the one it was pointed at, on a deployment its owner controls. Everything below is a boundary, not a preference, and a pass that crosses one is stopped and reported rather than finished.

## What a pass may do

Read the repository, the lockfile and the configuration. Build the application and search the output. Send requests to the application under test, including malformed ones, and record what comes back. Create test accounts inside the application and use them against each other. Fetch published advisories, standards and vendor documentation.

## What a pass may never do

**Nothing outside the application it was pointed at.** A dependency of the application, a provider it calls, a shared host, a sibling deployment and an upstream service are all third parties. Finding that an endpoint forwards a request somewhere is the finding; following it there is an attack on someone else. When the application itself is made to fetch something, the application is the actor and the target is chosen so it touches nothing else: its own loopback address by default, and never a live third-party service.

**No real credential.** A pass never enters a real password, an API key, a card number, a recovery code or a one-time code into anything, and never authenticates as a real user. Session handling is tested with the test accounts below, or with a session the owner supplies for the purpose, and the test says which.

**No production data.** Testing runs against a build made for it, with its own store. Where only production exists, the pass sends only requests that touch no real record: public responses, and the accounts created for the test and removed at the end; the steps that need more are recorded as not run with the reason. Reading, deleting, exporting, importing over or copying real records is out of bounds in every case, and so is a test session writing to a store that also holds real data.

**No third-party secret is ever verified against its provider by exercising it.** A scanner that reports a credential as live has already made that call under its own terms; a pass does not make it again by hand, and it does not use a found credential for anything.

**No denial of service.** Limits are proved by finding the ceiling and the response at it, not by exceeding it until something falls over. A load test that could degrade a shared service needs the owner's agreement first, in the same session.

**Nothing left behind.** Test accounts, uploaded files, created records and configuration changes are listed as they are made and removed at the end. What could not be removed is reported by name.

## Test accounts

These count as test accounts, and a pass may sign in with them:

- **Accounts the pass registers** through the application's own registration, with credentials invented for the test and removed at the end.
- **Demo or fixture accounts documented in the repository**, such as a seed file or a readme, on a local build made for the test with its own store. Their documented passwords are fixtures, not credentials, on that build only; the same accounts on a shared or production deployment are real.
- **A session the owner supplies** for the purpose.

Where none of these exists, the steps that need a session run from the repository and the runtime half is recorded as not run with the reason.

## Findings are written down, not exploited further

The moment a step produces a result that proves the failure, the step is finished. Chaining one finding into another to demonstrate impact belongs to an engagement with a scope agreement, not to a protocol run. The finding carries the evidence that proves it and the evidence that would prove it fixed, and that is the whole deliverable.

A failure already under active exploitation is a P0 and is reported the moment it is confirmed, before the rest of the pass continues.

## Where the pass stops and a person decides

Accepting a risk that has no patch. Choosing a verification level. Ordering a credential rotation against the outage it causes. Submitting a domain to a list that takes months to leave. Deciding that an endpoint's exposure is intended. Each of these is recorded with the evidence and a name, and the pass continues without assuming an answer.
