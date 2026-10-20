# Essentials

Read first when writing a product's text from scratch or running a pass over a whole product: the floor rules and a default for every value a writer would otherwise invent. A category file is opened only for the subcategories the work contains, for its `Build:` line; the topic files settle what this page does not.

## Floor rules

1. Nothing is invented. A figure, a customer, a quote, a date, a price, a command, a sender or a name the text needs and the brief does not hold is written as the missing-fact marker below, never as a plausible value.
2. Words a named person said, identifiers, brand names and legal text keep their exact form, as in [boundaries.md](boundaries.md). A quote already in the target is never cut by a pass; one that cannot be traced is flagged for the owner.
3. Result first. The first words of any string are the thing the reader came for: the outcome, the fix or the fact.
4. One name per object on every surface and in both languages, fixed once in the word table of the voice file.
5. Every error, blocked control and empty state names one next action that exists in the product. When none exists, the gap is reported, not papered over.
6. Both languages are written in the same pass, as whole sentences with named placeholders, and the code that joins fragments is changed as part of the copy work ([bilingual-copy](protocols/bilingual-copy.md), step 3).
7. Every flag-list word takes the deletion test in [tells.md](tells.md); a first draft targets zero pattern hits and zero dashes.
8. What could not be checked with the tools at hand is recorded as not verifiable, and the work continues.

## Missing facts

A fact the text needs and nobody has supplied is written as `[[missing: what]]`, in English in every language column, for example `[[missing: product name]]` or `[[missing: release date]]` (Convention: one fixed marker, found by one search for `\[\[missing:`, visible when rendered). Every marker is listed in the report with its location.

- Product name absent: a plain noun phrase where a sentence allows it (*this invoicing app*), and the marker where only a name works: a title, a sender, a copyright line.
- In a rewrite pass, existing text that a rule would replace with an unknown fact stays as it is and is listed for the owner. A vague changelog entry is kept, not guessed at.
- A slot whose asset is missing, such as a testimonial or a screenshot, holds the marker as visible text. An empty element or a code comment is not a visible gap.

## Defaults

Each value applies until the project's voice file says otherwise. Measured, Convention and Practice are the marks in [options.md](options.md#marks-used-in-this-module).

| Item | Default | Source |
| --- | --- | --- |
| Tone | Plain; Warm for onboarding and first-use empty states | Convention, [options.md](options.md#tone) |
| Person | None on buttons and labels; second person in interface, onboarding and email; impersonal in documentation, reference, pricing and legal | Convention, [options.md](options.md#person) |
| Button | Verb and object, four words at most; a destructive action names its object whatever the length | Convention, [microcopy.md](microcopy.md#buttons-and-controls) |
| Label, column header, nav item | Noun phrase, no period; a nav item uses the words of the heading it opens | Convention, [microcopy.md](microcopy.md#navigation-and-menus) |
| Casing | Sentence case everywhere, no period or colon at the end of a heading; Spanish never uses title case | Microsoft style guide, top 10 tips |
| Sentence length | Prose: a mean under 25 words with a standard deviation of at least 5, judged from fifteen sentences; paragraphs of five sentences at most | Convention, [measures.md](measures.md#sentence-length-mean-and-standard-deviation) |
| Reading level | No grade target; plain words from [tells.md](tells.md#plain-word-substitutions) | Convention |
| Headings | At least five lines of body, except the readme and reference headings a reader scans for | Convention, [tells.md](tells.md#structural-tells) |
| Lists | A lead-in line, fragment items with no end punctuation, numbered only for steps in order | GOV.UK A to Z, bullet points |
| Dashes and contractions | No em dash and no spaced double hyphen; no contractions | Convention, [options.md](options.md#dash-policy) |
| Emoji | None in any text; a message to a person mirrors an emoji only after that person used one; icon slots and brand marks are not text | Convention, [options.md](options.md#emoji) |
| Errors | The row of its cause in [microcopy.md](microcopy.md#table-of-causes): one instruction for a field the reader fixes, with no *please*, *sorry*, *invalid* or *oops*; cause, next step and kept input for a system failure; one message for either sign-in credential | GOV.UK error message; NN/g; OWASP |
| Empty state | The row of its kind in [microcopy.md](microcopy.md#empty-states): a title naming the object, why it is empty, one action; no joke | Carbon empty states pattern |
| Onboarding | No tour unless the product needs input to start; each step the outcome, then one action; skip visible | NN/g mobile-app onboarding |
| Success | What happened, then what happens next when something does | Convention, [microcopy.md](microcopy.md#success) |
| Numbers, dates, currency, time and quotes | Digits for counts; every value from the locale formatter through a placeholder, in the per-language formats of [options.md](options.md#numbers-dates-currency-and-quotation-marks), relative time included | CLDR 48; RAE DPD |
| Spanish register | Neutral impersonal, as [options.md](options.md#spanish-register) defines | Practice |
| Email sender | The product for product mail; the person for mail sent on their behalf | Convention, [messages.md](messages.md#email) |
| Changelog categories | Added, Changed, Deprecated, Removed, Fixed, Security, kept in English in every language | Keep a Changelog 1.1.0 and its Spanish translation |

Sources: GOV.UK (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/ and https://design-system.service.gov.uk/components/error-message/), Microsoft (https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice), NN/g (https://www.nngroup.com/articles/error-message-guidelines/ and https://www.nngroup.com/articles/mobile-app-onboarding/), Carbon (https://v10.carbondesignsystem.com/patterns/empty-states-pattern/), OWASP (https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), Keep a Changelog (https://keepachangelog.com/en/1.1.0/).

## Order of work for a whole product

1. Voice file. Run [voice-specification](protocols/voice-specification.md) and write the result to `docs/voice.md`, or to a Voice section of the project's rules file when one exists.
2. Write by subcategory. For each string or passage, find its subcategory through [INDEX.md](INDEX.md), follow the `Build:` line, and use the table above for every format.
3. Verify. Run [copy-verification](protocols/copy-verification.md) in its first-draft form: zero pattern hits or each survivor justified, zero dashes, sentence statistics on prose only, and every missing-fact marker listed.

## Proportion

Every protocol scales to the text in front of it. A Time value is a ceiling, not a budget. A step that does not apply, such as rendering for a product without an interface, ends as not applicable with the reason in one line, and the run goes on. Every check ends as pass, fail, not applicable, not run or not verifiable; a fail stops the step and is reported, and not run and not verifiable carry their reason and never count as pass.
