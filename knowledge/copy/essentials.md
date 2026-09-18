# Essentials

The one file to read first when writing a product's text from scratch or running a pass over a whole product. It holds the floor rules and a concrete default for every value a writer would otherwise invent. Open a category file only for the subcategories the work contains, and read its `Build:` line; the topic files are for the cases this page does not settle.

## Floor rules

1. Nothing is invented. A figure, a customer, a quote, a date, a price, a command, a sender or a name the text needs and the brief does not hold is written as a missing-fact marker (below), never as a plausible value.
2. Words a named person said, identifiers, brand names and legal text keep their exact form (see [boundaries.md](boundaries.md)). A quote already in the target is never cut by a pass; one that cannot be traced is flagged for the owner.
3. Result first. The first words of any string are the thing the reader came for: the outcome, the fix or the fact.
4. One name per object on every surface and in both languages. The word table of the voice file fixes each name once.
5. Every error, blocked control and empty state names one next action that exists in the product. When none exists, the gap is reported, not papered over.
6. Both languages are written in the same pass, as whole sentences with named placeholders. The code that joins fragments is changed as part of the copy work (see [bilingual-copy](protocols/bilingual-copy.md), step 3).
7. Every flag-list word takes the deletion test in [tells.md](tells.md); the target for a first draft is zero pattern hits and zero dashes.
8. What could not be checked with the tools at hand is recorded as not verifiable, and the work continues.

## Missing facts

A fact the text needs and nobody has supplied is written as `[[missing: what]]`, in English in every language column, for example `[[missing: product name]]`, `[[missing: currency]]`, `[[missing: release date]]` or `[[missing: run command]]` (Convention: one fixed marker, found by one search for `\[\[missing:`, visible when rendered). Every marker is listed in the report with its location.

- Product name absent: a plain noun phrase where a sentence allows it (*this invoicing app*), and the marker where only a name works: a title, a sender, a copyright line.
- In a rewrite pass, existing text that a rule would replace with an unknown fact stays as it is and is listed for the owner. A vague changelog entry is kept, not guessed at.
- A slot whose asset is missing, such as a testimonial or a screenshot, holds the marker as visible text. An empty element or a code comment is not a visible gap.

## Defaults

Each value applies until the project's voice file says otherwise. Measured and Convention are the marks in [options.md](options.md).

| Item | Default | Source |
| --- | --- | --- |
| Tone | Plain; Warm for onboarding and first-use empty states | Convention, [options.md](options.md#tone) |
| Person | None on buttons and labels; second person in interface, onboarding and email; impersonal in documentation, reference, pricing and legal | Convention, [options.md](options.md#person) |
| Button | Verb and object, four words at most; a destructive action names its object whatever the length | Convention, [microcopy.md](microcopy.md#buttons-and-controls) |
| Label, column header, nav item | Noun phrase, no period; a nav item uses the words of the heading it opens | Convention, [microcopy.md](microcopy.md#navigation-and-menus) |
| Casing | Sentence case everywhere, no period or colon at the end of a heading; Spanish never uses title case | Microsoft style guide, top 10 tips |
| Sentence length | Split any sentence over 25 words; paragraphs of five sentences at most | GOV.UK, Use clear language |
| Reading level | No grade target; plain words from the substitution table in [tells.md](tells.md#plain-word-substitutions) | Convention, [measures.md](measures.md#readability-grade) |
| Headings | Sentence case, at least five lines of body, except readme and reference headings a reader scans for | Convention, [tells.md](tells.md#structural-tells) |
| Lists | A lead-in line, fragment items with no end punctuation, numbered only for steps in order | GOV.UK A to Z, bullet points |
| Dashes | None: no em dash and no spaced double hyphen | Convention, [options.md](options.md#dash-policy) |
| Contractions | None | Convention: GOV.UK avoids negative contractions, Microsoft uses contractions |
| Emoji | None in text; icon slots and brand marks are not text | Convention, [options.md](options.md#emoji) |
| Error, field the reader fixes | One instruction that states the fix: *Enter a due date*. No *please*, *sorry*, *invalid*, *valid* or *oops* | GOV.UK Design System, error message |
| Error, system failed | Impersonal cause, then the next step, then that the input was kept | NN/g error-message guidelines |
| Error, sign-in | One message for a wrong email or a wrong password | OWASP authentication cheat sheet |
| Empty state | Title naming the object, why it is empty, one action; no joke | Carbon empty states pattern |
| Onboarding | No tour unless the product needs input to start; each step outcome, then one action; skip visible | NN/g mobile-app onboarding |
| Success | What happened, then what happens next when something does | Convention, [microcopy.md](microcopy.md#success) |
| Numbers | Digits for counts; interface values formatted by the locale formatter from a placeholder, never typed into a template | Convention |
| Number format, English | `1,234.5` | CLDR 48, `en` |
| Number format, Spanish | `es` (Spain) `1234,5` and `12.345,6`; `es-419` and `es-MX` `1,234.5`; `es-AR` `1.234,5`. Hand-written prose: no separator up to four digits | CLDR 48; RAE DPD, números |
| Currency, English | Symbol first, no space: `$1,234.56`; the ISO code when the symbol is shared | CLDR 48, `en` |
| Currency, Spanish | `es` after, with a space: `1234,56 €`; `es-419` before, no space: `$1,234.56`; `es-AR` before, with a space; an alphabetic code always spaced: `25 USD` | CLDR 48; RAE DPD, símbolo 5.5 |
| Percent | `en` `25%`; `es` `25 %`; `es-419` `25%` | CLDR 48; RAE DPD, símbolo 5.4 |
| Date in text | English `September 18, 2026`; Spanish `18 de septiembre de 2026`; no all-digit dates, since the two orders differ (`M/d/yy` against `d/M/yy`) | CLDR 48 long and short formats; RAE DPD, fecha |
| Date in a changelog | ISO 8601, `2026-09-18` | Keep a Changelog 1.1.0 |
| Time | `en` `3:30 PM`; `es` `15:30`; `es-419` `3:30 p.m.`, all from the formatter | CLDR 48 short time |
| Quotation marks | English “ ” then ‘ ’; Spanish « » then “ ” then ‘ ’ | CLDR 48 `en`; RAE DPD, comillas |
| Spanish register | Neutral tú in sentences, infinitive on buttons and menu items | Practice, [options.md](options.md#spanish-register) |
| Spanish greeting | `Hola, {first_name}:` with a colon, never a comma | RAE DPD, dos puntos 2.9 |
| Email sender | The product for product mail; the person for mail sent on their behalf | Convention, [messages.md](messages.md#email) |
| Changelog categories | Added, Changed, Deprecated, Removed, Fixed, Security, kept in English in every language | Keep a Changelog 1.1.0 and its Spanish translation |
| Missing fact | `[[missing: what]]`, listed in the report | Convention, above |

Sources: CLDR 48 locale data (https://github.com/unicode-org/cldr-json), RAE Diccionario panhispánico de dudas (https://www.rae.es/dpd/), GOV.UK (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/ and https://design-system.service.gov.uk/components/error-message/), Microsoft (https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice), NN/g (https://www.nngroup.com/articles/error-message-guidelines/ and https://www.nngroup.com/articles/mobile-app-onboarding/), Carbon (https://v10.carbondesignsystem.com/patterns/empty-states-pattern/), OWASP (https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), Keep a Changelog (https://keepachangelog.com/en/1.1.0/).

## Order of work for a whole product

1. Voice file. Run [voice-specification](protocols/voice-specification.md) and write the result to `docs/voice.md`, or to a Voice section of the project's rules file when one exists. It holds the four tone values, the word table, the sentence rules, the languages and register, and the one-language list.
2. Write by subcategory. For each string or passage, find its subcategory through [INDEX.md](INDEX.md), follow the `Build:` line, and use the table above for every format.
3. Verify. Run [copy-verification](protocols/copy-verification.md) in its first-draft form: zero pattern hits or each survivor justified, zero dashes, sentence statistics on prose only, and every missing-fact marker listed.

## Proportion

Every protocol scales to the text in front of it. A Time value is a ceiling, not a budget. A step that does not apply, such as rendering for a product without an interface, ends as not applicable with the reason in one line, and the run goes on.
