name: copy-verification
purpose: Produce the numbers that show this draft improved on the one before it, and name the ones that prove nothing.
scope: any copy change before it ships, and the end of every rewrite pass
trigger: manual, after any rewrite pass and before any copy change ships
repeat: once per draft
inputs: the draft, the draft before it, the definitions in measures.md, the dash policy in options.md, a style linter configured for the project
stop: no previous draft exists to compare against, in which case the run records the figures as a baseline and ends after step 3
report: the four signals before and after, the hits remaining per pattern class with their justifications, the linter errors, and the word ratio

## Steps

1. Take the densities.
   Task: count words, tell hits and dashes on both drafts, following the exclusions in [measures.md](../measures.md), and compute tell density and dash density for each.
   Time: 10 minutes.
   Result: four figures recorded side by side. Tell density has fallen or is zero, and dash density is within the policy in [options.md](../options.md). A figure that did not move sends the draft back to [tell-removal](tell-removal.md) instead of forward.

2. Run the pattern pass.
   Task: run the copula-avoidance, trailing-participial, negative-parallelism, vague-attribution and collaborative-residue searches from [tells.md](../tells.md) over the new draft.
   Time: 5 minutes.
   Result: every search returns zero hits, or each survivor is listed with the file, the line and the sentence that earns it. An unexamined hit count is not a result.

3. Measure the shape.
   Task: compute the mean and the standard deviation of sentence length for both drafts, and a readability grade when the text is long form. The signal is the variance, since the failure being corrected is uniform density rather than length (https://arxiv.org/abs/2410.16107).
   Time: 10 minutes.
   Result: mean and standard deviation recorded for both drafts, or recorded as not applicable under the rule for string sets in [measures.md](../measures.md). Where applicable, the standard deviation is at or above the threshold there, and any grade is reported as the change against the previous draft.

4. Run the linter.
   Task: run vale, proselint or the linter the project already uses, with the project configuration, over both drafts. When the project has none, record that and skip.
   Time: 5 minutes.
   Result: the error count for each draft is recorded and the new draft introduces zero new errors, or the absence of a linter is recorded. Errors inherited from the configuration are listed once and left alone.

5. Compute the ratio.
   Task: compute words after divided by words before, and take the claim counts from [claim-check](claim-check.md) when the draft asserts anything about quality, scale or importance.
   Time: 5 minutes.
   Result: the word ratio is recorded with a one-line reason for any increase, and the count of superlatives without a referent is zero where claim-check applied.
