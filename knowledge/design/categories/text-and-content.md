# Text and content blocks

How text is set and grouped on the page: headings, paragraphs, lists, quotes, figures inside text, snippets. The wording belongs to the copy module; this category covers how the words are laid out and read. Structural words are the exception, written by the design pass as [essentials.md](../essentials.md#floors) lists them and flagged for the copy pass.

## Headings and hierarchy

Applies when: headings are added or restyled; a request says "the hierarchy is flat", "nothing stands out", "the title is too big"; heading levels are skipped; a heading ends on one stranded word.

Build: One level-one heading per view and levels in order, each level on a heading role from the tokens, `text-wrap: balance` on headings, more space above a heading than below it, sentence case.

Options:

- **Size-led hierarchy** for marketing and story pages, with one display statement where scale is earned.
- **Weight-and-space-led hierarchy** for apps and reading, where sizes stay close and weight, tone and space do the work.
- **A short label above a heading**, rationed across a marketing page, or as the card-kind label of an app shell; never on every section.

Open: [hierarchy-and-type](../protocols/hierarchy-and-type.md); [tokens.md, Type roles](../tokens.md#type-roles); [defaults.md, Template chrome](../defaults.md#template-chrome).

## Body text and reading

Applies when: paragraphs, articles or documentation change; lines run too long; a request says "hard to read", "wall of text"; a subheading or a helper sentence repeats what the heading says; a block of several lines is centred.

Build: `max-width` of 55 to 60ch on prose in a proportional sans, which gives 65 to 75 characters a line and never more than 80, as the measure row of [essentials.md](../essentials.md#default-values) sets; line height 1.5; paragraphs spaced on the within-group band; links in text underlined with an offset; `text-align: start` on any text of two lines or more.

Options:

- **One reading path** for long form, with related links collected in one block at the end rather than scattered.
- **Cut the text** before restyling it: each idea said once, no sentence under a heading that restates it.
- **Start-aligned text** for anything that runs past one line; centring suits one line only, such as a lone title or a short label.
- **Reading aids** for long pages: a progress bar, a last updated date, a table of contents, a print stylesheet where documents get printed.

Open: [hierarchy-and-type](../protocols/hierarchy-and-type.md), steps 3 and 6; [site-polish.md, Build when the site calls for it](../site-polish.md#build-when-the-site-calls-for-it).

## Lists, FAQs and disclosure

Applies when: a list grows long, a set of questions and answers is added, content is hidden behind expanders, or a request says "too much on the page".

Build: Native `ul` and `ol` for lists. An FAQ as `details` and `summary`, or as a button with `aria-expanded` and `aria-controls` that toggles its panel on Enter and Space, one question per item.

Options:

- **A plain list** for up to about five items.
- **Grouped columns, a card grid or tabs** when a marketing list runs longer, or the top three to five with a link to the rest.
- **An expandable FAQ** for short answers that would otherwise become a wall.
- **Progressive disclosure** for advanced detail: the common path shown, the rest one level deeper.

Open: [pages-and-sections.md, Sections](../pages-and-sections.md#sections); [ux-laws.md, Decision cost and attention](../ux-laws.md#decision-cost-and-attention); [animation.md, Recipes](../animation.md#recipes) for the accordion.

## Figures in text

Applies when: prices, statistics, dates, times or measurements appear in running text or in a column; numbers shift width as they change; a time is shown relative to now.

Build: Format numbers, currency and dates with the locale's formatter, such as `Intl.NumberFormat`, `Intl.DateTimeFormat` and `Intl.RelativeTimeFormat` in a browser; dates and times in a `time` element with its `datetime`, the absolute value reachable on focus when the text is relative; `tabular-nums`, numeric columns right-aligned, and a value kept with its unit through `white-space: nowrap`.

Options:

- **Tabular numerals** for any figure that is compared or changes.
- **Relative time** for recent activity, with the cut-overs in the copy module's [options.md](../../copy/options.md#numbers-dates-currency-and-quotation-marks); an absolute date for anything a person plans by.
- **Real or labelled figures**: a number is real data or marked as an example, never invented precision.

Open: [hierarchy-and-type](../protocols/hierarchy-and-type.md), step 5; [responsive-behaviour](../protocols/responsive-behaviour.md), step 4.

## Quotes, reviews and proof

Applies when: testimonials, reviews, case studies or logos are added to a page.

Build: A `figure` holding a `blockquote` and a `figcaption` that names the person and the role, three lines at most; a quote that is not real is left out.

Options:

- **Short attributed quotes**, three lines at most, with a name and a role.
- **Case studies** that show the work rather than adjectives.
- **A logo band** of real marks under the hero.
- **Nothing**, when the proof is not real: an invented review is worse than none.

Open: [pages-and-sections.md, Sections](../pages-and-sections.md#sections); [icons-and-media.md, Images](../icons-and-media.md#images).

## Code and copyable values

Applies when: code samples, commands, keys, identifiers or codes appear on a page.

Build: A `pre` holding `code`, with a copy button that writes to the clipboard and puts "Copied" in a status region; `code` inline inside sentences.

Options:

- **A block with a copy button** and a short confirmation, for anything meant to be pasted.
- **Inline monospace** for a command or a path inside a sentence. Monospace is for code and measurement only.

Open: [site-polish.md, Build first](../site-polish.md#build-first); [defaults.md, Template chrome](../defaults.md#template-chrome).
