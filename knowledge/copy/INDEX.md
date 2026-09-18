module: copy
purpose: Writing and rewriting text by category, from a button label to an agent prompt, without the habits that make text read as machine-written.

# Copy

A button label, an error message and a product page fail in different ways, so copy work is split by category. Match the text against the lines below, open only the matching category files, and from each one only the protocols and topic sections it names. Most work matches one or two categories; text that matches none is not copy work.

Writing a product's text from scratch, or a pass over a whole product, starts with [essentials.md](essentials.md): the floor rules, the missing-fact marker and a default for every format, so that a small product touching most categories does not need the whole module.

## Categories

- [interface](categories/interface.md): buttons and controls, labels, placeholders, helper text, tooltips, navigation and menus.
- [feedback](categories/feedback.md): errors, blocked controls, warnings and confirmations, success, empty states, loading and progress.
- [onboarding](categories/onboarding.md): welcome and first screen, setup steps, first-use empty state.
- [marketing](categories/marketing.md): hero, feature sections, pricing, calls to action, proof and claims, footers.
- [long-form](categories/long-form.md): articles, announcements.
- [releases](categories/releases.md): changelogs, release notes, breaking changes and deprecations, commit messages.
- [documentation](categories/documentation.md): tutorials, how-to guides, reference, explanation, readmes.
- [messages](categories/messages.md): email, notifications, status reports and replies, assistant and chatbot replies included.
- [localization](categories/localization.md): authoring both columns, register and address, templates and plurals, keys and stored text.
- [agent-facing](categories/agent-facing.md): prompts and briefs, rules files, knowledge topics, documents another person authors.

## Routing

Which protocol steps and topic sections each category sends work to, so the protocols can be chosen before a category file is opened. A category file is still opened for its `Build:` recipes and options. Every run ends with copy-verification. A new product, or a request for a voice, starts with voice-specification; any other pass reads the voice file when one exists and never creates it, as in [boundaries.md](boundaries.md#the-voice-file). What each step checks is one line in [steps.md](steps.md): steps are picked there, and a whole pass on a small surface opens only the protocols whose steps it will actually run. A topic is read by the section of each matched subcategory, named in its category file, not whole.

| Category | Protocols and steps | Topic sections |
| --- | --- | --- |
| interface | surface-copy 1 to 6; bilingual-copy 1 to 5 with a second language | microcopy, per subcategory |
| feedback | surface-copy 1 to 6; rewrite-boundary 1 to 3 for safety or consent wording | microcopy, per subcategory; boundaries: Filler only |
| onboarding | surface-copy 1 to 6; bilingual-copy 1 to 5 with a second language | microcopy: Onboarding steps, Empty states |
| marketing | surface-copy 1 to 6; tell-removal 1 to 8; claim-check 1 to 5; rewrite-boundary 4 for footer and pricing lines | pages, per subcategory; tells: Combined pattern, Running the searches; boundaries: Consistency instead of rewrite |
| long-form | tell-removal 1 to 8; claim-check 1 to 5 | pages: Articles, Announcements; tells |
| releases | surface-copy 1 to 6; claim-check 1 to 5 for notes claiming improvements | documents, per subcategory |
| documentation | surface-copy 1 to 6; tell-removal 1 to 8 for prose; rewrite-boundary 1 to 3 for reference | documents, per subcategory; tells: Combined pattern, Running the searches |
| messages | surface-copy 1 to 6; tell-removal 1 to 8 for a draft written with a model | messages, per subcategory |
| localization | bilingual-copy 1 to 5 | bilingual, per subcategory |
| agent-facing | surface-copy 1 to 6; tell-removal 1 to 8 for rules files | agent-text, per subcategory; boundaries |

## Protocols

- [rewrite-boundary](protocols/rewrite-boundary.md): scope any text about to be rewritten. Marks what may change, what may only lose filler and what stays literal.
- [tell-removal](protocols/tell-removal.md): scope any draft written with a model or reading as generated. Removes machine-written patterns by deletion test, not by ban list.
- [surface-copy](protocols/surface-copy.md): scope any diff that adds or changes text a person or an agent reads. Holds each string to the rules of its own subcategory.
- [claim-check](protocols/claim-check.md): scope marketing pages, announcements, articles and release notes. Ties every claim to something that exists.
- [voice-specification](protocols/voice-specification.md): scope a new product or section, or a request for a voice. Records the option values once so reviewers can check against them.
- [bilingual-copy](protocols/bilingual-copy.md): scope any string set in more than one language. Writes both columns together in the chosen register.
- [copy-verification](protocols/copy-verification.md): scope any copy change before it ships, a first draft included. Produces the signals that show the draft is clean or improved.

Every protocol scales to the text in front of it: a Time value is a ceiling, a step that does not apply ends as not applicable with its reason, and evidence the tools at hand cannot produce is recorded as not verifiable while the run continues.

## Topics

Read only when a category or a protocol step points at them.

- [essentials.md](essentials.md): the floor rules, the missing-fact marker and the default for every format, with sources.
- [options.md](options.md): tone, person, length, line shape, dash policy, casing, emoji, opening and closing, register, claim level, and the marks Measured, Convention and Practice.
- [boundaries.md](boundaries.md): where not to rewrite: quoted text, identifiers, legal, consent, safety and reference.
- [tells.md](tells.md): the flag list, the pattern classes with their searches, the structural tells and plain word substitutions.
- [measures.md](measures.md): every figure reported, how the corpus is extracted from pages and code, how each figure is computed and what it does not prove.
- [microcopy.md](microcopy.md), [pages.md](pages.md), [documents.md](documents.md), [messages.md](messages.md), [agent-text.md](agent-text.md) and [bilingual.md](bilingual.md): the rules per subcategory.

## Command

[humanize](features/humanize.md) takes a text, resolves its categories, rewrites it and shows the signals before and after. It composes after other work in the same request.

## What the counts are not

The tell list is a writing-quality checklist, never evidence of authorship. One study tested fourteen detection systems and found them neither accurate nor reliable, with a bias toward calling text human-written (https://arxiv.org/abs/2306.15666). A high count says the text is worth another pass, and nothing else. A rule that would only be worth following to defeat a detector does not belong here.
