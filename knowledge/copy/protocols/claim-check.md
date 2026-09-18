name: claim-check
purpose: Keep every claim of quality, scale or importance tied to something that exists, and nothing invented to fill a gap.
scope: marketing and product pages, announcements, articles, release notes, and any text that asserts quality, scale or importance
trigger: manual, on any diff that adds or changes such a claim
repeat: once per draft
inputs: the draft, the product brief or rules file, the legal and policy pages of the same site
stop: the draft asserts nothing about quality, scale or importance, in which case the run ends after step 1; a step with nothing to act on ends as not applicable, and a referent the tools at hand cannot trace is recorded as not verifiable
report: claims with a referent against claims without, the invented items removed, the existing quotes and names flagged for the owner, the missing-fact markers placed, the claims that contradicted a policy page, and the positioning check

## Steps

1. List the claims.
   Task: list every sentence that asserts quality, scale, speed, popularity, importance or a result for the reader, with its location.
   Time: 10 minutes.
   Result: a numbered list of claims, or a recorded zero.

2. Give each claim its referent.
   Task: mark each claim as carrying a number, a name or a date, or as carrying none. Cut every claim that carries none, or replace it with the fact that would have shown it. Quoted words of a person are not claims of the text and are left to step 3. An existing changelog or release-note entry with no referent is never cut in a rewrite pass: it stays and goes to the owner list, as in [documents.md](../documents.md#changelogs).
   Time: 15 minutes.
   Result: the count of superlatives without a referent is zero, and the count of claims cut is recorded (Convention as a target, Measured as a direction: objective language measured higher usability, https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/).

3. Check that each referent exists.
   Task: trace every figure, customer name, testimonial, logo and screenshot to a file, a record or a published source. Split what traces to nothing by origin. An item the current draft introduced is removed, and its slot holds the missing-fact marker from [essentials.md](../essentials.md#missing-facts) as visible text. An item already in the target before the pass, above all a quote with a named person attached, is never removed or edited: it is listed for the owner with its location, as [boundaries.md](../boundaries.md) requires. A repository alone rarely holds the record of a customer quote, so its absence there proves nothing.
   Time: 15 minutes.
   Result: every remaining referent has a location, the count of invented items left from the draft is zero, every pre-existing item without a record is listed for the owner and unchanged in the diff, and each slot now holding a marker is listed.

4. Match the policy pages.
   Task: compare every claim paired in [rewrite-boundary](rewrite-boundary.md) with its policy page, and rewrite the claim wherever the two disagree.
   Time: 10 minutes.
   Result: the count of claims contradicting a policy page is zero, and each rewritten claim is listed with the page it now agrees with.

5. Check the positioning.
   Task: compare the first sentence of the page, and any sentence saying what the product is, with the product brief.
   Time: 5 minutes.
   Result: each such sentence either matches the brief or is rewritten to match it, and any description left over from an earlier framing is listed as replaced.
