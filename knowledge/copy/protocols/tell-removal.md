name: tell-removal
purpose: Remove the patterns that make a draft read as machine-written, keeping every word that is doing work.
scope: any prose or string set written or rewritten with a model, or that reads as generated, in any category
trigger: manual, on any draft written or rewritten with a model
repeat: once per draft, and again after any rewrite of it
inputs: the draft, the marks from rewrite-boundary, the catalogue in tells.md, the definitions in measures.md, the dash policy in options.md
stop: every section is marked untouchable by rewrite-boundary, in which case the run ends after step 1
report: the four signals before and after, hits per pattern class before and after, the count of flagged words kept with a reason, and the word ratio

## Steps

1. Count the baseline.
   Task: count the words of the draft with code blocks, tables and quotations excluded, run the pattern searches from [tells.md](../tells.md), and count dashes as defined in [measures.md](../measures.md).
   Time: 5 minutes.
   Result: a recorded table with the word count, the hits per pattern class, the tell density, the dash density and the sentence length mean and standard deviation.

2. Respect the marks.
   Task: take the marks from [rewrite-boundary](rewrite-boundary.md), or run it when none exist. Sections marked filler only receive step 3 and nothing else; untouchable sections and fenced literal spans receive nothing.
   Time: 5 minutes.
   Result: the sections open to rewrite are listed, and no defined term, clause, obligation, number, identifier or quoted word is altered in any other section.

3. Run the deletion test on the flag list.
   Task: for each flag-list hit and each collaborative residue hit, delete the words and read the sentence. Keep the deletion when the meaning is unchanged. Restore the words when the meaning is lost, and write the reason on that line.
   Time: 20 minutes for a draft under two thousand words.
   Result: every hit from step 1 carries one of three marks, deleted, replaced or kept, and the count of each is recorded. Every kept word has a reason next to it.

4. Restore the copula.
   Task: rewrite each copula-avoidance hit to *is*, *has* or the concrete verb, unless the verb is literally true of the subject.
   Time: 10 minutes.
   Result: the copula-avoidance search returns zero hits, or each survivor is listed with the sentence that makes the verb literally true.

5. Cut the impact clauses, the negative parallelism and the triads.
   Task: delete each trailing participial clause whole, then check that the sentence left behind is still complete. Rewrite each negative parallelism as the positive claim alone. Cut each rule-of-three triad to the items that carry information.
   Time: 15 minutes.
   Result: both searches return zero hits, except for uses of *rather than* that carry a real contrast, each listed. The count of triads cut is recorded, and a before and after pair is kept for the three longest cuts.

6. Replace vague attribution and undue significance.
   Task: give each vague attribution a named source with a date, or delete the claim it was carrying. Delete each undue-significance hit, or replace it with the fact that would have shown the importance.
   Time: 15 minutes.
   Result: both searches return zero hits, and the count of claims deleted for want of a source is recorded.

7. Fix the structural tells and the dashes.
   Task: apply the structural list in [tells.md](../tells.md): sentence-case headings with no ending period, no bold inside paragraphs, headings below the body floor merged upward, the restating closing paragraph deleted, full-sentence lists returned to prose, emoji and meta-labels removed. Replace each dash above the policy in [options.md](../options.md) with a comma, a colon, parentheses or a new sentence.
   Time: 10 minutes.
   Result: zero title-case headings, zero bold runs inside paragraph text, dash density within the policy, and a recorded count of headings merged, closings deleted and lists converted.

8. Recount and compare.
   Task: repeat step 1 on the rewritten draft and put the two tables side by side.
   Time: 5 minutes.
   Result: tell density is lower than the baseline or already zero, dash density is within the policy, and the word ratio is recorded. A density that did not fall means the pass failed and is run again rather than reported.
