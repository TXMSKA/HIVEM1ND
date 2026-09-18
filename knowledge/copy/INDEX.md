module: copy
purpose: Writing and rewriting text by category, from a button label to an agent prompt, without the habits that make text read as machine-written.

# Copy

A button label, an error message and a product page fail in different ways, so copy work is split by category. Match the text against the lines below, open only the matching category files, and from each one only the protocols and topic sections it names. Most work matches one or two categories; text that matches none is not copy work.

## Categories

- [interface](categories/interface.md): buttons and controls, labels, placeholders, helper text, tooltips, navigation and menus.
- [feedback](categories/feedback.md): errors, blocked controls, warnings and confirmations, success, empty states, loading and progress.
- [onboarding](categories/onboarding.md): welcome and first screen, setup steps, first-use empty state.
- [marketing](categories/marketing.md): hero, feature sections, pricing, calls to action, proof and claims, footers.
- [long-form](categories/long-form.md): articles, announcements.
- [releases](categories/releases.md): changelogs, release notes, breaking changes and deprecations, commit messages.
- [documentation](categories/documentation.md): tutorials, how-to guides, reference, explanation, readmes.
- [messages](categories/messages.md): email, notifications, status reports and replies.
- [localization](categories/localization.md): authoring both columns, register and address, templates and plurals, keys and stored text.
- [agent-facing](categories/agent-facing.md): prompts and briefs, rules files, knowledge topics, documents another person authors.

## Protocols

- [rewrite-boundary](protocols/rewrite-boundary.md): scope any text about to be rewritten. Marks what may change, what may only lose filler and what stays literal.
- [tell-removal](protocols/tell-removal.md): scope any draft written with a model or reading as generated. Removes machine-written patterns by deletion test, not by ban list.
- [surface-copy](protocols/surface-copy.md): scope any diff that adds or changes text a person or an agent reads. Holds each string to the rules of its own subcategory.
- [claim-check](protocols/claim-check.md): scope marketing pages, announcements, articles and release notes. Ties every claim to something that exists.
- [voice-specification](protocols/voice-specification.md): scope a new product or section, or a rewrite across categories. Records the option values once so reviewers can check against them.
- [bilingual-copy](protocols/bilingual-copy.md): scope any string set in more than one language. Writes both columns together in the chosen register.
- [copy-verification](protocols/copy-verification.md): scope any copy change before it ships. Produces the signals that show the draft improved.

## Topics

Read only when a category or a protocol step points at them.

- [options.md](options.md): tone, person, length, line shape, dash policy, casing, emoji, opening and closing, register, claim level, and the marks Measured, Convention and Practice.
- [boundaries.md](boundaries.md): where not to rewrite: quoted text, identifiers, legal, consent, safety and reference.
- [tells.md](tells.md): the flag list, the pattern classes with their searches, the structural tells and plain word substitutions.
- [measures.md](measures.md): every figure reported, how it is computed and what it does not prove.
- [microcopy.md](microcopy.md), [pages.md](pages.md), [documents.md](documents.md), [messages.md](messages.md), [agent-text.md](agent-text.md) and [bilingual.md](bilingual.md): the rules per subcategory.

## Command

[humanize](features/humanize.md) takes a text, resolves its categories, rewrites it and shows the signals before and after. It composes after other work in the same request.

## What the counts are not

The tell list is a writing-quality checklist, never evidence of authorship. One study tested fourteen detection systems and found them neither accurate nor reliable, with a bias toward calling text human-written (https://arxiv.org/abs/2306.15666). A high count says the text is worth another pass, and nothing else. A rule that would only be worth following to defeat a detector does not belong here.
