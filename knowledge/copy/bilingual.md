# Bilingual copy

A second language is not a pass over a finished text. It is a second column written at the same time as the first. Writing one language and translating it later costs several times more, because the layout was already built around the wrong lengths.

## Expansion

Measured. Text translated from English into European languages grows, and the shorter the source string the more it grows (https://www.w3.org/International/articles/article-text-size).

| Source length in characters | Average expansion |
| --- | --- |
| up to 10 | 200 to 300 percent |
| 11 to 20 | 180 to 200 percent |
| 21 to 30 | 160 to 180 percent |
| 31 to 50 | 140 to 160 percent |
| 51 to 70 | 151 to 170 percent |
| over 70 | 130 percent |

The consequence is the opposite of the intuition: the short labels squeezed into tabs, buttons and table headers are the ones that break, and long paragraphs are comparatively safe.

Two working rules follow. For anything inside a fixed container, write the longer language first and size the container to it. Where a container cannot be made flexible, the label is chosen so that the longest translation fits, even when a shorter English word was available.

## Write both, do not translate one

Both columns are written in the same sitting, by whoever is writing the copy, before the component is built. A string that exists in one language only is not finished.

The practical form is a table or a resource file with one row per key and one column per language, and no row left half empty. Review reads the row, not the column.

## Spanish conventions

- English gerund titles become infinitives. *Getting started* becomes *Empezar*, not *Empezando*.
- Spanish has no title case. Sentence case always, including headings, buttons and menu items.
- Opening question and exclamation marks are obligatory, not optional decoration.
- Nouns carry gender and number, and everything around them agrees. This is why the next rule exists.

## Templates, never concatenation

Concatenated fragments break agreement, because the fragment that would decide gender and number is chosen at runtime and the other fragment was written for a different one.

Every message is one whole sentence with named placeholders, stored as one string per language:

- Good: `Se eliminaron {count} archivos.` and `{count} files were deleted.`
- Bad: `"Se eliminaron " + count + " " + itemName`

Where a count changes the sentence, the plural forms are separate whole strings, one per form the language needs. Where a noun changes the sentence, the sentence is written per noun rather than assembled.

## Add the verb to short labels

A bare English noun or fragment gives Spanish nothing to agree with, so the translator has to guess a gender and a number that the interface never told them.

A label that is a fragment in English becomes a whole action in both columns. *Filters* becomes *Filtrar*, and the English column becomes *Filter* to match. This costs one word in English and removes a whole class of wrong translations.

## Verification

- Render both languages at the narrowest supported width and capture each.
- No label clipped, truncated with an ellipsis or wrapped onto a third line.
- No string built by concatenation anywhere in the copy layer.
- Every key present in every language, with the count of missing keys at zero.
