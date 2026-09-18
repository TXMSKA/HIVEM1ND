# Measures

Every number this module reports is defined here: what it counts, how it is produced, whether a source fixes it or the module chose it, and what it does not prove.

All densities are per thousand words of the corpus defined below.

## The corpus

Two runs over the same target produce the same figures only when they count the same text. The corpus is a plain UTF-8 file, one unit per line, where a unit is one string a person reads as it appears on screen or on the page.

- HTML: the text of the body, plus the attributes a person reads: `title`, `alt`, `placeholder`, `aria-label`, the `value` of a button input, the page `<title>` and the meta description. Never script or style content, comments, or attributes that name things: `id`, `class`, `name`, `href`, `data-*`.
- JavaScript and TypeScript: string and template literals that reach the screen, meaning the values of translation tables, JSX text and readable attributes, and the arguments of text setters and dialogs such as `textContent`, `innerText`, `alert`, `confirm` and toast calls. Never keys, identifiers, URLs, selectors, event names, strings only compared in code, or log lines read by operators.
- Server code: messages sent to a client in a response body, and email and notification templates. Never log lines or exceptions that no client receives.
- Markdown and documents: headings, paragraphs and list items. Never code blocks, inline code or tables.
- Assembled strings: fragments joined in code are written as the one sentence a person sees, with each variable as a named placeholder, `You have {count} tasks pending`. A placeholder counts as one word.
- Each string once: a string repeated across files or call sites is one unit.
- One corpus per language. Tell and dash signals are defined for English; the other languages report word count and the checks of [bilingual-copy](protocols/bilingual-copy.md).
- Marks from [rewrite-boundary](protocols/rewrite-boundary.md): untouchable units and quoted material are left out. Filler-only units go to a separate corpus reported on its own line, so that unchanged legal text does not dilute the figures of the open text.

Words are the whitespace-separated tokens that contain a letter or a digit. A sentence ends at a period, question mark or exclamation mark followed by a space or the end of the unit, except after *e.g.*, *i.e.* and *etc.*; a unit with no end mark is one sentence.

## The four signals

Any rewrite reports four figures before and after, side by side: tell density, dash density, sentence length standard deviation, and word count. The word ratio, words after divided by words before, is derived from the two word counts and is reported whenever a previous draft exists. A first draft reports the four figures once, with the word ratio as not applicable. The four are cheap to compute on any text and hard to game without improving it. The other measures below are run when a protocol step asks for them.

Sentence statistics are computed on prose only: the body text of long form, of documentation other than reference, of email, and of announcements and release notes. A readme, a how-to guide or any other document whose body is mostly commands, numbered steps and short entries is not prose, even outside reference: its sentences are reported with the microcopy below. Buttons, labels, headings, navigation, errors, empty states, toasts, onboarding steps, page slots, changelog entries and every other interface string are microcopy, where fragments and single sentences are what the rules ask for, so they are left out (Convention). When the prose holds fewer than five sentences, the statistics are reported as not applicable.

## Tell density

What it counts: the matches of the combined pattern in [tells.md](tells.md#combined-pattern), less the flag-list matches that passed the deletion test and are kept with a reason, divided by the word count, times one thousand. Class matches always count, including the ones kept with a reason.

How: run the combined pattern over the corpus with one of the commands in [tells.md](tells.md#running-the-searches). Because the matches do not overlap, a span that two lists both catch counts once, and every inflection of a flag word is caught. The per-class counts for the report come from running each class search on its own; their sum can exceed the combined count, and only the combined count enters the density.

Mark: the flag list is Measured (319 excess style words in 2024 across more than 15 million abstracts, https://arxiv.org/abs/2406.07016). No source fixes a threshold, so there is none. The number is used as a regression: the density after a pass is compared with the density before it, and the pass fails when it did not fall.

Does not prove: authorship. See the note in [INDEX.md](INDEX.md).

## Dash density

What it counts: the em dash character (U+2014), plus the double hyphen typed in its place, per thousand words. The search is `\u2014|\s--\s`, written `\x{2014}|\s--\s` for grep with Perl syntax (see [tells.md](tells.md#running-the-searches)).

Mark: Measured baseline, Convention cap. Published essays across literary criticism, journalism and technical writing were measured at a weighted mean of 3.23 em dashes per thousand words, with a median of 3.83 and a range from 0.33 to 17.12. Unconstrained model output in the same study ran far higher, for example 10.62 per thousand words for one model, and an explicit instruction to write prose without markdown moved that figure only to 9.10 (https://arxiv.org/html/2603.27006v1).

The target follows the dash policy in [options.md](options.md). Under the default policy, none, the target is zero and this measure is a search that must return no hits. Under the cap policy the target is 3.23 per thousand words, the human mean; choosing the mean as a cap is a convention, not a finding, since the human range is wide and a text above the cap is a text to look at, not a text that is wrong.

## Pattern searches

What it counts: hits per class, from [tells.md](tells.md).

Mark: Measured as a catalogue, in that each class is a documented pattern, and Convention as a target. The target used here is zero hits per class, with each surviving hit listed next to the sentence that earns it. A list of three justified survivors is a pass. An unexamined count is not.

## Sentence length mean and standard deviation

What it counts: words per sentence, both the mean and the standard deviation across the text.

Why the standard deviation and not the mean alone: model prose is denser and more nominalised than human prose, using present participial clauses at two to five times the human rate and nominalisations at one and a half to two times, and instruction-tuned models vary more erratically from feature to feature while failing to match human stylistic variation (https://arxiv.org/abs/2410.16107). Hedging is not a reliable signal in either direction: in that study one model family used downtoners more often than humans and another avoided them.

The consequence for editing: the fix for dense prose is variance, not shortness. A draft rewritten into uniformly short sentences scores worse on this measure, not better. The measure is about prose; a label cut to a fragment follows its own rule and is outside it.

Mark: Convention for the threshold. The module uses a standard deviation of at least five words, alongside a mean under twenty-five. Both are chosen values. A project may set its own and check against those. The standard deviation threshold applies from fifteen sentences of prose; below that, the figure is reported before and after without a pass or fail, because a few short, correct sentences cannot vary much. A draft is never padded to reach it.

## Readability grade

What it counts: any standard grade formula, applied to the draft and to the draft before it.

Mark: Convention, and deliberately weak. The grade is reported as a regression, meaning the new draft is compared with the old one, and never as a truth claim about a reader. No specific grade target is set by this module; a project that sets one owns it.

## Style linter

What it counts: errors from a style linter such as vale or proselint, run with the project configuration.

Mark: Convention. The target is zero new errors against the previous draft, not zero errors, because an inherited configuration may disagree with the project voice.

## Word ratio

What it counts: words after divided by words before, per surface or per string.

Why: shorter measured better. Against a promotional control, concise text scored 58 percent higher on usability, a scannable layout 47 percent higher, objective language 27 percent higher, and all three combined 124 percent higher, where usability was the geometric mean of task time, task errors, memory, sitemap time and subjective satisfaction (https://www.nngroup.com/articles/concise-scannable-and-objective-how-to-write-for-the-web/).

Mark: the study is Measured. The ratio target is Convention: this module expects a ratio below 1.0 for any rewrite pass, and requires a written reason for any string that grew. A first draft has no ratio; its length is held by the length option of each subcategory instead.

## Claim audit

What it counts: claims carrying a number, a name or a date, against superlatives with no referent.

How: [claim-check](protocols/claim-check.md) lists every sentence that asserts quality, scale or importance. Each one either carries a figure, a named thing or a date, or it is cut.

Mark: Convention as a ratio, Measured as a direction, since objective language was one of the three variables that improved usability in the study above. The target is zero superlatives without a referent.

## Bullet ratio and words per heading

Mark: Convention, both. The module uses no more than one bulleted list per four paragraphs, and at least five lines of body under any heading. Neither has a source. They exist so that the structural tells in [tells.md](tells.md) have a number to fail against.
