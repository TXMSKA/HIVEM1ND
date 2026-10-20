# Rules of engagement

A security pass tests one application: the one it was pointed at, on a deployment its owner controls. Everything below is a boundary, not a preference, and a pass that would cross one stops that step, records it as not run with the reason, and goes on.

## What a pass may do

Read the repository, the lockfile and the configuration. Build the application into its own output folder and search the output. Send requests to the application under test, including malformed ones, and record what comes back. Create test accounts inside the application and use them against each other. Write scratch files in a folder outside the repository, such as a planted line for a positive control or a copy of the manifest, and delete them at the end. Fetch published advisories, standards and vendor documentation.

## Test fixtures

An audit is read-only on the repository. A proof that needs something written into the project, such as a temporary endpoint, a test credential or a pipeline job, is a test fixture:

- It is written only on a separate branch, after the person's yes for that fixture.
- It never holds a live credential: only a value invented for the test or a provider's documented example value.
- It is removed after the proof, and the removal is listed in the report.

Without the yes, the part of the step that needs the fixture is recorded as not run, and the repository reading stands as the evidence.

## Secret values

- A secret value never enters the conversation, a report, a file the pass writes or a command line.
- A search for a leaked value reads it from the environment or the secret store inside the command and prints only whether it matched, in the forms in [evidence.md](evidence.md#searching-for-a-secret-value).
- A scanner runs with its value redaction on and its verification off.
- A third-party credential is never exercised against its provider, by hand or through a scanner. Whether it is live, and whether a rotation took effect, is confirmed in the provider's own console or by the person.
- A found credential is used for nothing.

## What a pass may never do

- Nothing outside the application it was pointed at. A dependency, a provider it calls, a shared host, a sibling deployment and an upstream service are third parties. Finding that an endpoint forwards a request somewhere is the finding; following it there is an attack on someone else. When the application itself is made to fetch something, the target is its own loopback address by default, and never a live third-party service.
- No real credential. A pass never enters a real password, an API key, a card number, a recovery code or a one-time code into anything, and never authenticates as a real user.
- No production data. Testing runs against a build made for it, with its own store. Where only production exists, the pass sends only requests that touch no real record: public responses, and the accounts created for the test and removed at the end. Reading, deleting, exporting, importing over or copying real records is out of bounds in every case, and so is a test session writing to a store that also holds real data.
- No denial of service. A limit is proved by sending requests until the first refusal and stopping there; nothing is sent past it. A load test that could degrade a shared service needs the owner's agreement first, in the same session.
- Nothing left behind. Test accounts, uploaded files, created records, fixtures and scratch files are listed as they are made and removed at the end. What could not be removed is reported by name.

## Test accounts

These count as test accounts, and a pass may sign in with them:

- Accounts the pass registers through the application's own registration, with credentials invented for the test and removed at the end.
- Demo or fixture accounts documented in the repository, such as a seed file, on a local build made for the test with its own store. Their documented passwords are fixtures on that build only; the same accounts on a shared or production deployment are real.
- A session the owner supplies for the purpose.

Where none of these exists, the steps that need a session run from the repository and the runtime half is recorded as not run with the reason.

## Findings are written down, not exploited further

The moment a step produces a result that proves the failure, the step is finished. Chaining one finding into another to demonstrate impact belongs to an engagement with a scope agreement, not to a protocol run. The finding carries the fields in [evidence.md](evidence.md#ranking-findings), and that is the whole deliverable.

A P0, or a failure already under active exploitation, is reported the moment it is confirmed, before the rest of the pass continues.

## Where the pass stops and a person decides

These are decisions, not checks: building a threat model, accepting a risk that has no patch, choosing a verification level, ordering a credential rotation against the outage it causes, submitting a domain to a list that takes months to leave, deciding that an exposure is intended, and the values a step marks as policy. A step marked `Needs a person:` names such a decision. The step records the evidence and the decision with a name against it, and the pass continues without assuming an answer. A decision taken silently inside a pass is itself a finding.
