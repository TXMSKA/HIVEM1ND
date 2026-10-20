module: copy
purpose: Writing and rewriting text by category, from a button label to an agent prompt, without the habits that make text read as machine-written.

Read this file, open only the category files the text matches, and from each only the protocols and topic sections it names. Most work matches one or two categories; text that matches none is not copy work. Writing a product's text from scratch, or a pass over a whole product, reads [essentials.md](essentials.md) first. A `Build:` line is the recipe to start from; what every text must meet is the floor rules in essentials.md. A plan cites a subcategory by its heading link, such as `categories/feedback.md#errors`.

## Categories

- [interface](categories/interface.md): buttons and controls, labels, placeholders, helper text, tooltips, navigation and menus, alternative text.
- [feedback](categories/feedback.md): errors, blocked controls, warnings and confirmations, success, undo, empty states, loading and progress, permission requests.
- [onboarding](categories/onboarding.md): welcome and first screen, setup steps, section tours, first-use empty state.
- [marketing](categories/marketing.md): hero, feature sections, pricing, calls to action, proof and claims, footers.
- [long-form](categories/long-form.md): articles, announcements.
- [releases](categories/releases.md): changelogs, release notes, breaking changes and deprecations, commit messages.
- [documentation](categories/documentation.md): tutorials, how-to guides, reference, explanation, readmes.
- [messages](categories/messages.md): email, notifications, status reports and replies, assistant and chatbot replies included.
- [localization](categories/localization.md): authoring both columns, register and address, templates and plurals, keys and stored text, right-to-left text.
- [agent-facing](categories/agent-facing.md): prompts and briefs, rules files, knowledge topics, documents another person authors.

## Routing

The protocol steps each category sends work to. [steps.md](steps.md) says what each step checks, and a protocol is opened only when one of its steps will run. Topic sections are read as the Open line of each subcategory touched, or a protocol step, names them. The voice file is read when one exists and created only as [boundaries.md](boundaries.md#the-voice-file) allows.

| Category | Protocols and steps |
| --- | --- |
| every run | rewrite-boundary 1 to 4 before any rewrite or shortening (step 3 alone for a first draft); copy-verification 1 to 5; voice-specification 1 to 6 (a new product or a request for a voice) |
| interface | surface-copy 1 to 6; bilingual-copy 1 to 5 (second language) |
| feedback | surface-copy 1 to 6 |
| onboarding | surface-copy 1 to 6; bilingual-copy 1 to 5 (second language) |
| marketing | surface-copy 1 to 6; tell-removal 1 to 8; claim-check 1 to 5 |
| long-form | tell-removal 1 to 8; claim-check 1 to 5 |
| releases | surface-copy 1 to 6; claim-check 1 to 5 (notes claiming improvements) |
| documentation | surface-copy 1 to 6; tell-removal 1 to 8 (prose) |
| messages | surface-copy 1 to 6; tell-removal 1 to 8 (a draft written with a model) |
| localization | bilingual-copy 1 to 5 |
| agent-facing | surface-copy 1 to 6; tell-removal 1 to 8 (rules files) |

## Protocols

- [rewrite-boundary](protocols/rewrite-boundary.md): scope any text about to be rewritten or shortened. Marks what may change, what may only lose filler and what stays literal.
- [tell-removal](protocols/tell-removal.md): scope any draft written with a model or reading as generated. Removes machine-written patterns by deletion test, not by ban list.
- [surface-copy](protocols/surface-copy.md): scope any diff that adds or changes text a person or an agent reads. Holds each string to the rules of its own subcategory.
- [claim-check](protocols/claim-check.md): scope marketing pages, announcements, articles and release notes. Ties every claim to something that exists.
- [voice-specification](protocols/voice-specification.md): scope a new product or section, or a request for a voice. Records the option values once so reviewers can check against them.
- [bilingual-copy](protocols/bilingual-copy.md): scope any string set in more than one language. Writes both columns together in the chosen register.
- [copy-verification](protocols/copy-verification.md): scope any copy change before it ships, a first draft included. Produces the signals that show the draft is clean or improved.

Every protocol scales to the text in front of it, as [essentials.md](essentials.md#proportion) sets out. The command [humanize](features/humanize.md) takes a text, resolves its categories, rewrites it and shows the signals before and after.
