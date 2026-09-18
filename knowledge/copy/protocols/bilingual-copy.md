name: bilingual-copy
purpose: Write both languages together and size every container for the longer one, so that nothing has to be translated twice.
trigger: manual, on any string set that ships in more than one language
repeat: once per string set, and again whenever a string is added to it
inputs: the string set, the containers that hold it, the figures and conventions in bilingual.md
stop: the product ships in one language and has no plan to ship in another, in which case the run ends after step 1
report: keys per language and missing keys, the count of concatenated strings, the count of labels clipped at the narrowest width, and the widths set from the longer language

## Steps

1. Declare the pair and the base.
   Task: write down which languages ship and which one is authored first. Anything inside a fixed container is authored in the longer language first, because short strings expand most (https://www.w3.org/International/articles/article-text-size).
   Time: 5 minutes.
   Result: both languages named in the project brief, with the authoring order recorded and the reason for it in one line.

2. Write both columns in the same pass.
   Task: create one row per key with one column per language and fill both before the component that uses the string is built.
   Time: varies with the string count.
   Result: the count of keys is identical in every language and the count of empty cells is zero.

3. Replace every concatenation with a whole-sentence template.
   Task: find every message assembled from fragments in the copy layer and rewrite it as one string per language with named placeholders, including one string per plural form the language needs.
   Time: 20 minutes.
   Result: a search for string concatenation in the copy layer returns zero hits, and every template is a single sentence whose placeholders are named.

4. Apply the per-language conventions.
   Task: take every string through the conventions in [bilingual.md](../bilingual.md). English gerund titles become Spanish infinitives, Spanish uses sentence case everywhere, opening question and exclamation marks are present, and any English label that is a bare fragment gains a verb in both columns.
   Time: 20 minutes.
   Result: zero title-case Spanish strings, zero Spanish questions or exclamations without their opening mark, and the count of English fragments turned into actions is recorded.

5. Size the containers and render both.
   Task: set each fixed container from the longest translation of the string it holds, then render every screen in every language at the narrowest supported width and capture each.
   Time: 30 minutes.
   Result: one capture per language per screen, zero labels clipped, truncated or wrapped onto a third line, and the containers whose width was set from the longer language listed by name.
