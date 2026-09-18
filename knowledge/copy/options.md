# Options

The choices a text has to make before it is written. Each category file names the value it defaults to and when to pick another. A project that records its own values in a voice specification (see [voice-specification](protocols/voice-specification.md)) overrides these defaults, and then applies its values everywhere without exception.

Every option here is Convention unless marked otherwise: a project may choose differently and stay correct, as long as it chooses once.

## Tone

Four dimensions, each scored from 1 to 5: formal against casual, serious against funny, respectful against irreverent, matter-of-fact against enthusiastic (Measured as a framework, https://www.nngroup.com/articles/tone-of-voice-dimensions/). Three presets cover most work:

- **Plain.** Neutral formality, serious, respectful, matter-of-fact. The default for interface text, feedback, documentation, releases, messages and agent text.
- **Warm.** More casual, still serious and respectful, a little enthusiasm allowed. Pick for onboarding and first-use states, and for a product whose audience is not at work. Its markers, all of them optional and none of them jokes: second person, the outcome for the reader named first (*Your first invoice is one step away*), the reader's first name when the product holds it, at most one exclamation per screen, and contractions only when the project uses them everywhere. Plain says *Create an invoice to see it here*; Warm says *Your invoices will show up here. Create the first one*.
- **Promotional.** Enthusiastic and claim-heavy. Pick only when a campaign asks for it by name. Against a promotional control, concise, scannable and objective text measured higher on usability (https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/), so the default for a product page is Plain, not this.

Funny and irreverent are never defaults. A joke in a string that repeats, such as an error, gets worse on every repetition.

## Person

- **Impersonal.** No *you*, no *we*. Statements about the thing, instructions as imperatives. Pick for documentation, reference, knowledge topics, agent text and public text read as an installer or a manual.
- **Second person.** *Your projects*, *you will receive*. Pick for interface text that addresses the person using it, onboarding and email, and use it at most once per sentence.
- **First person plural.** *We changed*. Pick for an announcement or release note signed by a team, where a named sender exists.
- **First person singular.** Pick only for a message from a named individual.

Buttons and labels take no person at all: a verb and an object.

## Length

- **Fragment.** Four words at most, no period. Buttons, labels, menu items, tabs, headings. A destructive button names its object whatever that costs.
- **One sentence.** Errors, notifications, tooltips, success lines, empty state bodies (two sentences at most).
- **Short block.** Five lines at most. Replies and status reports to a person, email bodies, onboarding steps.
- **Long form.** Articles, explanation, tutorials. Length follows the argument, and variance in sentence length matters more than the mean (see [measures.md](measures.md)).

## Line shape

- **Prose.** Default for articles, explanation and any reasoning where one sentence depends on the one before.
- **One fact per line.** Short bullets, each a single line. Pick for reports, inventories and anything scanned rather than read.
- **Title-only entries.** One self-describing title per line, no description under it. Pick for changelogs and patch notes whose readers scan for their feature.
- **Table.** Pick for comparisons across the same fields and for bilingual key sets. Never for a single column of items.

## Dash policy

- **None.** No em dash (U+2014) and no double hyphen standing in for one. A comma, a colon, parentheses or a new sentence does the job. The default of this module and the rule for this repository's own text.
- **Cap.** At most 3.23 per thousand words, the human mean measured in published essays (Measured baseline, Convention as a cap, see [measures.md](measures.md)). Pick for long form in a house that uses the dash.
- **Free.** No limit. Pick only for quoted material, which is untouchable anyway.

## Casing

Sentence case for headings, buttons, labels and menu items, with no period at the end of a heading (Measured, Microsoft style guide, https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice). Title case only where a house style already fixes it. Spanish has no title case at all.

## Contractions

Yes or no, decided once per project. *Can't* reads warmer than *cannot*, and a mixture of both reads careless. The published guides disagree: Microsoft uses contractions (https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice) and GOV.UK avoids negative ones (https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/style-guides/a-to-z-style-guide/). The module default is none, so that a project that never decides stays consistent (Convention).

## Emoji

- **None.** The default everywhere, including headings and bullets, where emoji as formatting is a catalogued tell (https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing). An emoji inside a label, a heading or a sentence is text and goes. A brand mark and an icon slot are not text: they belong to the design of the surface and are left to it.
- **Mirror.** In a message to a person, only after that person has used one.
- **Content.** Where the emoji is the thing being described, such as a reaction picker.

## Opening and closing

- **Result first.** The first line is what happened or what has to be done. No preamble, no restating of the request, no closing summary or offer. The default for messages, reports, errors, notifications and documentation.
- **Conventional frame.** A one-line greeting and a one-line sign-off, and nothing else around the content. Pick for email to someone outside the team.

## Spanish register

For any Spanish column. Register is decided once per product, written in its voice file (see [voice-specification](protocols/voice-specification.md)), and re-read before strings are called done, because a writer slips into their own dialect when writing fast (Practice).

- **Neutral tú.** *Crea*, *mira*. The default for public copy read across regions (Practice: regional voseo and the impersonal infinitive as body text were both rejected for such an audience).
- **Usted.** Pick for legal, financial, health or institutional products, and for audiences that expect it.
- **Regional form.** Pick only when the whole audience is in one region and the product speaks its dialect on purpose.
- **Infinitive.** Correct on buttons and menu items (*Guardar*, *Cancelar*), and for English gerund titles (*Empezar*, not *Empezando*). Not a register for sentences.

## Numbers, dates, currency and quotation marks

The format of each, per language, is fixed in the defaults table of [essentials.md](essentials.md#defaults) with its source in CLDR or the Real Academia Española. Three rules hold whatever the format (Convention):

- A value the interface shows is a named placeholder filled by the locale formatter of the platform, never separators or symbols typed into the template: `Total: {amount}`, not `Total: ${amount}.00`.
- A date in running text carries the month in words, because the all-digit forms read differently in English and Spanish.
- The locale tag is part of the voice file (`es-ES`, `es-419`, `en-US`), because Spanish number and currency formats differ between Spain and Latin America.

## Claim level

- **Verified only.** Every claim of quality, scale or importance carries a number, a name or a date that exists. The default.
- **No claims.** Reference, legal text and agent text describe; they do not assess.
- **Aspirational.** Plans stated as plans, only in a section labelled as a roadmap. Never mixed into a description of what exists.

## Marks used in this module

**Measured** means a cited study or published guideline reports it, and the figure in the text is the figure in the source. **Convention** means the module chose a value no source fixes. **Practice** means a rule adopted after drafts that did the opposite were rejected in real work; no source fixes it, and it is treated like a convention with a known failure behind it.
