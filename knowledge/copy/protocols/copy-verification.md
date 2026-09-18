name: copy-verification
purpose: Produce the numbers that show this draft improved on the one before it, and name the ones that prove nothing.
trigger: manual, after any rewrite pass and before any copy change ships
repeat: once per draft
inputs: the draft, the draft before it, the definitions in measures.md, a style linter configured for the project
stop: no previous draft exists to compare against, in which case the run records the figures as a baseline and ends after step 3
report: every figure before and after, the hits remaining per pattern class with their justifications, the word ratio, and the count of claims without a referent

## Steps

1. Take the densities.
   Task: count words, tell hits and em dashes on both drafts, following the exclusions in [measures.md](../measures.md), and compute tell density and em dash density per thousand words for each.
   Time: 10 minutes.
   Result: four figures recorded side by side. Tell density has fallen, and em dash density is at or below the cap. A figure that did not move sends the draft back to [tell-removal](tell-removal.md) instead of forward.

2. Run the pattern pass.
   Task: run the copula-avoidance, trailing-participial, negative-parallelism and vague-attribution searches from [tells.md](../tells.md) over the new draft.
   Time: 5 minutes.
   Result: every search returns zero hits, or each survivor is listed with the file, the line and the sentence that earns it. An unexamined hit count is not a result.

3. Measure the shape.
   Task: compute the mean and the standard deviation of sentence length, then compute a readability grade for both drafts. The signal is the variance, since the failure being corrected is uniform density rather than length (https://arxiv.org/abs/2410.16107).
   Time: 10 minutes.
   Result: mean, standard deviation and grade recorded for both drafts. The standard deviation is at or above the threshold in [measures.md](../measures.md), which is a convention of this module, and the grade is reported as the change against the previous draft and never as a claim about a reader.

4. Run the linter.
   Task: run vale, proselint or the linter the project already uses, with the project configuration, over both drafts.
   Time: 5 minutes.
   Result: the error count for each draft is recorded and the new draft introduces zero new errors. Errors inherited from the configuration are listed once and left alone.

5. Audit the claims and the ratio.
   Task: list every sentence asserting quality, scale or importance, and mark each as carrying a number, a name or a date, or as carrying none. Cut the ones carrying none. Then compute words after divided by words before.
   Time: 15 minutes.
   Result: the count of superlatives without a referent is zero, the word ratio is recorded, and any increase in length is explained in one line.
