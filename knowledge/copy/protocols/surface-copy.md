name: surface-copy
purpose: Hold every string to the rules of the surface it appears on, instead of one house style for all of them.
trigger: manual, on any diff that adds or changes a user-facing string
repeat: once per diff
inputs: the strings in the diff, the checklists in surfaces.md, the voice specification of the project when one exists
stop: the diff contains no user-facing string, in which case the run ends after step 1
report: strings per surface, checklist items failed and fixed per surface, the word ratio per surface, and the count of errors and empty states without a next action

## Steps

1. Inventory by surface.
   Task: list every string the diff adds or changes and assign each one to exactly one surface: product page, empty state, error, button or control, onboarding step, changelog entry, or documentation and reference.
   Time: 10 minutes.
   Result: a list where every string has a surface and no string has two. The count per surface is recorded.

2. Apply the checklist of each surface.
   Task: for each surface present, open its section in [surfaces.md](../surfaces.md) and take each string through its items.
   Time: 10 minutes per surface.
   Result: every string carries its checklist with each item ticked, or with an exception written on the item in one line. An untouched item counts as a failure.

3. Front-load, and cut the weak phrasing.
   Task: move the outcome to the first words of each string, start statements with a verb, and remove *you can*, *there is*, *there are* and *there were*. Then read each string aloud and rewrite anything that cannot be said in one breath.
   Time: 20 minutes.
   Result: the search `\b(you can|there (is|are|was|were))\b` returns zero hits outside quoted material, or each survivor is listed with its reason, and the count of strings rewritten after the read-aloud is recorded.

4. Shorten.
   Task: rewrite each string toward half its length, then restore only what was lost. Concise text measured higher usability than the promotional version it replaced, and shortening the copy is the single change that measured highest (https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/).
   Time: 20 minutes.
   Result: words after divided by words before is recorded per surface and is below 1.0, and every string that grew carries a written reason.

5. Close the dead ends.
   Task: check that every error and every empty state names one next action, and that the action is a real control or link on the same screen.
   Time: 10 minutes.
   Result: the count of errors and empty states without a next action is zero, and the count with more than one primary action is zero.
