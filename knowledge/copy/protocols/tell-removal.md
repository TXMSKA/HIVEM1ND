name: tell-removal
purpose: Remove the patterns that make a draft read as machine-written, keeping every word that is doing work.
trigger: manual, on any draft written or rewritten with a model
repeat: once per draft, and again after any rewrite of it
inputs: the draft, the catalogue in tells.md, the definitions in measures.md
stop: the text is legal, contractual, safety, consent, defined-term, technical reference or quoted material, in which case the run ends after step 2 with the filler pass only
report: tell density and em dash density before and after, hits per pattern class before and after, the count of flagged words kept with a reason, and the word ratio

## Steps

1. Count the baseline.
   Task: count the words of the draft with code blocks, tables and quotations excluded, run the six pattern searches from [tells.md](../tells.md), and count em dashes.
   Time: 5 minutes.
   Result: a recorded table with the word count, the hits per pattern class, the tell density per thousand words and the em dash density per thousand words.

2. Classify the text.
   Task: decide whether the draft has to stay unambiguous under adversarial reading. Legal and contractual text, defined terms, safety and consent language, technical reference and anything quoted all do. Mark the draft, or each section of it, as open to rewrite or as filler only.
   Time: 5 minutes.
   Result: every section of the draft carries one of the two marks. Sections marked filler only receive step 3 and nothing else, and no defined term, clause, obligation or quoted word is altered in them.

3. Run the deletion test on the flag list.
   Task: for each flag-list hit, delete the word and read the sentence. Keep the deletion when the meaning is unchanged. Restore the word when the meaning is lost, and write the reason on that line.
   Time: 20 minutes for a draft under two thousand words.
   Result: every hit from step 1 carries one of three marks, deleted, replaced or kept, and the count of each is recorded. Every kept word has a reason next to it.

4. Restore the copula.
   Task: rewrite each copula-avoidance hit to *is*, *has* or the concrete verb, unless the verb is literally true of the subject.
   Time: 10 minutes.
   Result: the copula-avoidance search returns zero hits, or each survivor is listed with the sentence that makes the verb literally true.

5. Cut the impact clauses and the negative parallelism.
   Task: delete each trailing participial clause whole, then check that the sentence left behind is still complete. Rewrite each negative parallelism as the positive claim alone.
   Time: 15 minutes.
   Result: both searches return zero hits, except for uses of *rather than* that carry a real contrast, each listed. A before and after pair is recorded for the three longest cuts.

6. Replace vague attribution and undue significance.
   Task: give each vague attribution a named source with a date, or delete the claim it was carrying. Delete each undue-significance hit, or replace it with the fact that would have shown the importance.
   Time: 15 minutes.
   Result: both searches return zero hits, and the count of claims deleted for want of a source is recorded.

7. Fix the structural tells.
   Task: apply the structural list in [tells.md](../tells.md). Headings to sentence case with no ending period, bold removed from mid paragraph, headings with less body than the floor in [measures.md](../measures.md) merged upward, the closing paragraph that restates deleted, and any list of full sentences returned to prose.
   Time: 10 minutes.
   Result: zero title-case headings, zero bold runs inside paragraph text, and a recorded count of headings merged, closing paragraphs deleted and lists converted.

8. Recount and compare.
   Task: repeat step 1 on the rewritten draft and put the two tables side by side.
   Time: 5 minutes.
   Result: tell density is lower than the baseline, em dash density is at or below the cap in [measures.md](../measures.md), and the word ratio is recorded. A density that did not fall means the pass failed and is run again rather than reported.
