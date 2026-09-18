name: bilingual-copy
purpose: Write both languages together, in the chosen register, and size every container for the longer one, so that nothing has to be translated twice.
scope: any string set that ships in more than one language, any fixed container that holds text, and any code that stores or displays translated text
trigger: manual, on any string set that ships in more than one language
repeat: once per string set, and again whenever a string is added to it
inputs: the string set, the containers that hold it, the product's rules file, the figures and conventions in bilingual.md
stop: the product ships in one language and has no plan to ship in another, in which case the run ends after step 1
report: languages, base and register, keys per language and missing keys, concatenated strings, translated text found in stored data, labels clipped at the narrowest width, and the widths set from the longer language

## Steps

1. Declare the languages, the base and the register.
   Task: write down which languages ship, the base language, the register of each language from the options in [options.md](../options.md), and the strings kept in one language on purpose. Anything inside a fixed container is authored in the longer language first, because short strings expand most (https://www.w3.org/International/articles/article-text-size).
   Time: 5 minutes.
   Result: languages, base, register and the one-language list recorded in the rules file of the product, with the authoring order and its reason in one line.

2. Write both columns in the same pass.
   Task: create one row per key with one column per language, and fill both before the component that uses the string is built. Labels, sample content and demo data follow the base language.
   Time: varies with the string count.
   Result: the count of keys is identical in every language and the count of empty cells is zero, except for keys on the one-language list.

3. Replace concatenation, and store keys.
   Task: rewrite every message assembled from fragments as one string per language with named placeholders, including one string per plural form the language needs. Find every place translated text is written to storage and store the key instead.
   Time: 20 minutes.
   Result: a search for string concatenation in the copy layer returns zero hits, every template is a single sentence with named placeholders, and zero translated strings are written to stored data.

4. Apply the per-language conventions and re-read the register.
   Task: take every string through the conventions in [bilingual.md](../bilingual.md): gerund titles as infinitives, sentence case, opening question and exclamation marks, verbs added to bare fragments, identifiers left in English. Then re-read every string in the second language for the register declared in step 1.
   Time: 20 minutes.
   Result: zero title-case Spanish strings, zero questions or exclamations without their opening mark, zero identifiers outside English, zero strings in a register other than the declared one, and the count of fragments turned into actions recorded.

5. Size the containers and render both.
   Task: set each fixed container from the longest translation of the string it holds, then render every screen in every language at the narrowest supported width and capture each.
   Time: 30 minutes.
   Result: one capture per language per screen, zero labels clipped, truncated or wrapped onto a third line, and the containers whose width was set from the longer language listed by name.
