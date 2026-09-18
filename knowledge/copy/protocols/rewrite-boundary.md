name: rewrite-boundary
purpose: Mark what a rewrite may change, what it may only trim and what it may not touch, before any word changes.
scope: any text about to be rewritten, and first in every run of humanize; for a first draft, only step 3 runs, to fence identifiers, placeholders and facts supplied verbatim in the brief
trigger: manual, before any rewrite pass
repeat: once per target
inputs: the target text, the lists in boundaries.md
stop: every section is marked untouchable, in which case the run ends after step 2 and the target is reported as out of scope; a step with nothing to act on in the text at hand ends as not applicable with its reason, and evidence the tools at hand cannot produce is recorded as not verifiable while the run continues
report: the sections with their mark, the count of identifiers and quotations fenced, and the policy pages a claim must agree with

## Steps

1. Split the target into sections.
   Task: divide the target into units that can carry one mark each: a paragraph, a string, a clause of a legal page, a block of reference.
   Time: 5 minutes.
   Result: a numbered list of sections, together covering the whole target with no overlap.

2. Mark each section.
   Task: take each section through [boundaries.md](../boundaries.md) and give it one mark: open, filler only, or untouchable.
   Time: 10 minutes.
   Result: every section carries exactly one mark, and every filler-only or untouchable mark names the list item that set it.

3. Fence what stays literal inside open sections.
   Task: inside the sections marked open, list every identifier, quotation, brand name, defined term and verbatim string supplied for the work. A quotation with a named person attached is fenced whatever the pass later learns about it (see [boundaries.md](../boundaries.md#untouchable)).
   Time: 5 minutes.
   Result: a list of literal spans, each with its section number. A later pass that changes any of them has failed.

4. Name the statement of record.
   Task: when an open section makes a claim about cookies, data, pricing terms or any subject a legal or policy page covers, record that page.
   Time: 5 minutes.
   Result: each such claim is paired with the page it has to agree with, or the list is recorded as empty.
