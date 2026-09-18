# Text and content blocks

How text is set and grouped on the page: headings, paragraphs, lists, quotes, figures inside text, snippets. The wording itself belongs to the copy module; this category covers how the words are laid out and read. Structural words are the exception: a visible label, an accessible name, the reason a control is disabled, the action of an empty state, the recovery of an error and the skip link are written by the design pass that builds the structure and flagged for the copy pass.

## Headings and hierarchy

Applies when: headings are added or restyled; a request says "the hierarchy is flat", "nothing stands out", "the title is too big"; heading levels are skipped; a heading ends on one stranded word.

Options:

- **Size-led hierarchy** for marketing and story pages, with one display statement where scale is earned.
- **Weight-and-space-led hierarchy** for apps and reading, where sizes stay close and weight, tone and space do the work.
- **A short label above a heading**, rationed across a marketing page, or as the card-kind label of an app shell; never on every section.

Build: One level-one heading per view and levels in order, each level on a heading role from the tokens, `text-wrap: balance` on headings, more space above a heading than below it, sentence case.

Open: [hierarchy-and-type](../protocols/hierarchy-and-type.md); [tokens.md](../tokens.md), Type roles; [defaults.md](../defaults.md), Template chrome.

## Body text and reading

Applies when: paragraphs, articles or documentation change; lines run too long; a request says "hard to read", "wall of text"; a subheading or a helper sentence repeats what the heading says.

Options:

- **Reading measure** of 65 to 75 characters for prose, with a looser line height; tighter for compact interface text.
- **One reading path** for long form, with related links collected in one block at the end rather than scattered.
- **Cut the text** before restyling it: each idea said once, no sentence under a heading that restates it.
- **Reading aids** for long pages: a progress bar, a last updated date, a table of contents, a print stylesheet where documents get printed.

Build: `max-width` of 65 to 70ch on prose, line height 1.5, paragraphs spaced on the within-group band, links in text underlined with an offset.

Open: [hierarchy-and-type](../protocols/hierarchy-and-type.md), steps 3 and 6; [site-polish.md](../site-polish.md), Build when the site calls for it.

## Lists, FAQs and disclosure

Applies when: a list grows long, a set of questions and answers is added, content is hidden behind expanders, or a request says "too much on the page".

Options:

- **A plain list** for up to about five items.
- **Grouped columns, a card grid or tabs** when a marketing list runs longer, or the top three to five with a link to the rest.
- **An expandable FAQ** for short answers that would otherwise become a wall.
- **Progressive disclosure** for advanced detail: the common path shown, the rest one level deeper.

Build: Native `ul` and `ol` for lists. An FAQ as `details` and `summary`, or as a button with `aria-expanded` and `aria-controls` that toggles its panel on Enter and Space, one question per item.

Open: [pages-and-sections.md](../pages-and-sections.md), Sections; [ux-laws.md](../ux-laws.md), Hick and Miller; [animation.md](../animation.md), Recipes, for the accordion.

## Figures in text

Applies when: prices, statistics, dates or measurements appear in running text or in a column; numbers shift width as they change.

Options:

- **Tabular numerals** for any figure that is compared or changes.
- **Locale formatting** for numbers, dates and currency, never string concatenation.
- **Real or labelled figures**: a number is real data or marked as an example, never invented precision.

Build: Format numbers, currency and dates with the locale's formatter, such as `Intl.NumberFormat` and `Intl.DateTimeFormat` in a browser; set `tabular-nums`, right-align numeric columns, and keep a value with its unit through `white-space: nowrap`.

Open: [hierarchy-and-type](../protocols/hierarchy-and-type.md), step 5; [responsive-behaviour](../protocols/responsive-behaviour.md), step 4.

## Quotes, reviews and proof

Applies when: testimonials, reviews, case studies or logos are added to a page.

Options:

- **Short attributed quotes**, three lines at most, with a name and a role.
- **Case studies** that show the work rather than adjectives.
- **A logo band** of real marks under the hero.
- **Nothing**, when the proof is not real: an invented review is worse than none.

Build: A `figure` holding a `blockquote` and a `figcaption` that names the person and the role, three lines at most; a quote that is not real is left out.

Open: [pages-and-sections.md](../pages-and-sections.md), Sections; [icons-and-media.md](../icons-and-media.md), Images.

## Code and copyable values

Applies when: code samples, commands, keys, identifiers or codes appear on a page.

Options:

- **A block with a copy button** and a short confirmation, for anything meant to be pasted.
- **Inline monospace** for a command or a path inside a sentence. Monospace is for code and measurement only.

Build: A `pre` holding `code`, with a copy button that writes to the clipboard and puts "Copied" in a status region; `code` inline inside sentences.

Open: [site-polish.md](../site-polish.md), Build first; [defaults.md](../defaults.md), Template chrome.
