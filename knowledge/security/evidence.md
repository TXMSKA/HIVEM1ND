# Evidence

A protocol step is finished when it has produced an artifact. Five kinds count, and nothing else does. A step reported as "reviewed", "checked" or "looks fine" is a step that was not run, and it is recorded as not run rather than left out.

## Command with its output

The command exactly as executed, the directory it ran in, and the output it produced, trimmed but never paraphrased. A command whose output is not recorded proves that the command exists, not that it passed.

Every command carries one mark: **repository** when it reads files and needs no service, or **running application** when it needs the application up at a known address. A running-application command also records the address and the build it hit, because the same command against a stale deployment is evidence about the stale deployment.

## Status code

The request and the response status, recorded as one line: the actor, the method, the path, the identifier used, and the code returned. Authorization evidence is a table of these, one row per role against one endpoint, because a single passing request proves one path and the failure being looked for is the path nobody tried.

A 2xx where a denial was expected is the finding. A 500 is also a finding: it means the check was reached by an input it did not expect, and it belongs to [logging-and-errors](protocols/logging-and-errors.md) as well as to whatever protocol found it.

## Version comparison

The installed version, the fixed version from the advisory, and the advisory identifier, on one line. The installed version is read from the lockfile or from the running process, never from the manifest range, because a range is an intention and the lockfile is what shipped.

A version check against a number written in a document is worth nothing once the document is a month old. The comparison is made against the vendor advisory fetched in the same pass, and the advisory URL is recorded beside the numbers.

## Search that returns no hits

The negative checks in the protocols are run as searches over the source tree, and the finished result is zero hits. The search expression is recorded with the result, so a later pass can run the same search. When hits remain, each one carries a file and line reference and the reason it is allowed to stand.

A search nobody ran is not a clean search, and a search narrowed until it returned nothing is a finding about the search.

## Query result

The state of the data after an action, read from the store rather than from the response body. A write that was supposed to be rejected is proved rejected by the row being unchanged, not by the status code alone, because a handler can return 403 and still have written.

## What is not evidence

A clean dependency audit is evidence of a clean dependency audit and nothing more. It does not read install scripts, and a version poisoned in the last few hours has no advisory yet.

A refusal from a model is not evidence that an injection failed. The pass condition is that the injected instruction reached nothing privileged, which is proved on the tool call and the credential boundary, not on the wording of the reply.

A report-only content security policy is not an enforcing policy. A header present on a 200 is not a header present on a 500. A test that only ran against a local build is not a statement about production.

## Findings that need a person

Some results cannot be settled inside a pass. Building a threat model, accepting a risk that has no patch, choosing a verification level, submitting a domain to a preload list whose removal takes months, and ordering a credential rotation against the downtime it causes are all decisions, not checks. The step records the evidence, names the decision, and stops there with a name against it. A decision taken silently inside a pass is itself a finding.

## Ranking findings

Findings are ranked so that a long list stays usable. The test for the boundary between the first two: whether the failure can be reached from outside without a credential.

| Rank | Meaning | When it is fixed |
| --- | --- | --- |
| P0 | Reachable without a credential, or exposes another account's data, or is under active exploitation | Immediately, before anything else in the pass |
| P1 | Requires a credential or an unlikely condition, but crosses a boundary when it lands | Before the change ships |
| P2 | Weakens a defence without crossing a boundary on its own | In the next pass |
| P3 | Hardening with no path to impact found | When there is time |

Every check ends in one verdict: pass, fail, or not applicable with the reason. Nothing ships with an open fail. A P2 or P3 left for a later pass is a risk accepted, recorded as a decision with a name against it, as below.

Every finding carries the location, the evidence that proves it, the impact in one line, the fix, and the evidence that would prove it fixed. A finding without a fix is an observation, and a list of observations is not a report. A finding whose fix cannot be verified by the same kind of artifact that found it is incomplete.
