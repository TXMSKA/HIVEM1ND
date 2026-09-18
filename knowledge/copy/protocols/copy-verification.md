name: copy-verification
purpose: Produce the numbers that show a first draft is clean, or that a draft improved on the one before it, and name the ones that prove nothing.
scope: any copy change before it ships, and the end of every rewrite pass
trigger: manual, after any rewrite pass and before any copy change ships
repeat: once per draft
inputs: the draft, the draft before it when one exists, the definitions in measures.md, the dash policy in options.md, a style linter configured for the project when one exists
stop: none besides a failed step; with no previous draft the run is a first-draft run, where every comparison below is replaced by its absolute target; a step with nothing to act on in the text at hand ends as not applicable with its reason, and evidence the tools at hand cannot produce is recorded as not verifiable while the run continues
report: the four signals, before and after or once for a first draft, the hits remaining per pattern class with their justifications, the linter errors or its absence, the word ratio or not applicable, the missing-fact markers with their locations, and every check recorded as not verifiable

## Steps

1. Take the densities.
   Task: build the corpus as in [measures.md](../measures.md#the-corpus), then count words, tell hits and dashes on each available draft, and compute tell density and dash density for each.
   Time: 10 minutes.
   Result: the figures recorded, side by side when two drafts exist. Tell density has fallen or is zero, or, for a first draft, is zero apart from hits each kept with a reason; dash density is within the policy in [options.md](../options.md). A figure that misses its target sends the draft back to [tell-removal](tell-removal.md) instead of forward.

2. Run the pattern pass.
   Task: run the copula-avoidance, trailing-participial, negative-parallelism, vague-attribution and collaborative-residue searches from [tells.md](../tells.md) over the new draft.
   Time: 5 minutes.
   Result: every search returns zero hits, or each survivor is listed with the file, the line and the sentence that earns it. An unexamined hit count is not a result.

3. Measure the shape.
   Task: compute the mean and the standard deviation of sentence length on the prose of each draft, as [measures.md](../measures.md#the-four-signals) defines prose, and a readability grade when the text is long form and a previous draft exists. The signal is the variance, since the failure being corrected is uniform density rather than length (https://arxiv.org/abs/2410.16107).
   Time: 10 minutes.
   Result: mean and standard deviation recorded for each draft, or recorded as not applicable when the prose holds fewer than five sentences. Where applicable, the standard deviation is at or above the threshold in [measures.md](../measures.md#sentence-length-mean-and-standard-deviation), and any grade is reported as the change against the previous draft.

4. Run the linter.
   Task: run vale, proselint or the linter the project already uses, with the project configuration, over each draft. When the project has none or the tool is not installed, record the linter check as not verifiable with the tools at hand and go on.
   Time: 5 minutes.
   Result: the error count for each draft is recorded and the new draft introduces zero new errors, or zero errors for a first draft, or the absence of a linter is recorded. Errors inherited from the configuration are listed once and left alone.

5. Compute the ratio.
   Task: compute words after divided by words before when a previous draft exists, take the claim counts from [claim-check](claim-check.md) when the draft asserts anything about quality, scale or importance, and search for the missing-fact marker `\[\[missing:` from [essentials.md](../essentials.md#missing-facts).
   Time: 5 minutes.
   Result: the word ratio is recorded with a one-line reason for any increase, or as not applicable for a first draft; the count of superlatives without a referent is zero where claim-check applied; and every marker found is listed with its location.
