name: surface-copy
purpose: Hold every string to the rules of its own subcategory, instead of one house style for all of them.
scope: any diff that adds or changes a user-facing string, a page section, a message, a document entry or agent text
trigger: manual, on any diff that adds or changes such text
repeat: once per diff
inputs: the text in the diff, the category files, the topic sections they name, the voice specification of the project when one exists
stop: the diff contains no text a person or an agent reads, in which case the run ends after step 1
report: strings per subcategory, rule items failed and fixed per subcategory, the option values applied, the word ratio per subcategory, and the count of errors and empty states without a next action

## Steps

1. Inventory by subcategory.
   Task: list every string or passage the diff adds or changes, match each against the Applies when lines of the category files listed in [INDEX.md](../INDEX.md), and assign it to exactly one subcategory.
   Time: 10 minutes.
   Result: a list where every string has one subcategory and no string has two. The count per subcategory is recorded.

2. Fix the option values.
   Task: for each subcategory present, take the option values from the voice specification of the project, or from the defaults its category file names in [options.md](../options.md) terms: tone, person, length, line shape, dash policy, casing and register.
   Time: 5 minutes.
   Result: one recorded line of option values per subcategory, each value traceable to the specification or to a category default.

3. Apply the rules of each subcategory.
   Task: open only the topic sections the category file names and take each string through their items.
   Time: 10 minutes per subcategory.
   Result: every string carries its rule items ticked, or with an exception written on the item in one line. An untouched item counts as a failure.

4. Front-load, and cut the weak phrasing.
   Task: move the outcome to the first words of each string, start statements with a verb, and remove *there is*, *there are* and *there were*, and *you can* where the chosen person is not second person or the phrase adds nothing (https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice). Read each string aloud and rewrite anything that cannot be said in one breath.
   Time: 20 minutes.
   Result: the search `\b(you can|there (is|are|was|were))\b` returns zero hits outside quoted material, or each survivor is listed with its reason, and the count of strings rewritten after the read-aloud is recorded.

5. Shorten.
   Task: rewrite each string toward half its length, then restore only what was lost. Concise text measured higher usability than the promotional version it replaced (https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/).
   Time: 20 minutes.
   Result: words after divided by words before is recorded per subcategory and is below 1.0, and every string that grew carries a written reason.

6. Close the dead ends.
   Task: check that every error, blocked control and empty state names one next action, and that the action is a real control or link on the same screen.
   Time: 10 minutes.
   Result: the count of errors, blocked controls and empty states without a next action is zero, and the count with more than one primary action is zero.
