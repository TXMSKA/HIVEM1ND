# Boundaries

Where a rewrite pass does not go, or goes only as far as filler. The test is one question: could a reader looking for a loophole, a liability or a misquote read the new version differently from the old one. When the answer can be yes, the text is outside the pass.

Every rule here is Convention. No study fixes where rewriting stops; the cost of getting it wrong is what fixes it.

## Untouchable

Nothing changes, not even filler.

- Quoted text: a quotation, a testimonial, a person's own words, a cited error message, a line from a source. It is reproduced as written. A pass never deletes a quote that was already in the target, least of all one attributed to a named person: whether it is real is a fact the pass cannot settle, so a quote that traces to no record is listed for the owner with its location and left in place (Practice: a pass that cut an attributed customer quote as unverified removed content that had to stay verbatim). Only a quote the current draft itself invented is removed, and [claim-check](protocols/claim-check.md) step 3 is where that happens.
- Identifiers: routes, ids, keys, permission names, design tokens, CSS classes, file and command names, API fields, error codes. They stay in English and never follow the language of the text around them.
- Text supplied verbatim for the work: a label, a name or a line lifted from something the same author already published. It is copied as it stands (Practice).
- Brand and product names, with their casing.
- Licence texts, vendored notices and anything else reproduced under someone else's terms.

## Filler only

Filler words are removed. No term, clause, condition, number, obligation or defined word changes, and the order of sentences stays.

- Legal and contractual text: terms, privacy policy, cookie notice, licence summaries, disclaimers.
- Consent text: checkbox labels, cookie banner choices, permission prompts, statements about sharing data.
- Safety text: warnings about data loss, security, health or any action that cannot be undone.
- Technical reference: parameter and field descriptions, configuration keys, error code tables.
- Defined terms anywhere. A word a document defines keeps its exact spelling in every occurrence.

## Consistency instead of rewrite

A claim outside a legal or policy page that contradicts that page is fixed on the claim side. The policy page is the statement of record, and changing it is a decision for whoever owns it, not a copy edit (Practice: a footer line saying a site set no cookies contradicted the cookie notice of the same site).

## Code around the strings

The copy pass owns the code that decides which words appear, because the text cannot be right while that code is wrong (Practice: a pass that left fragment concatenation alone as a code change shipped a broken plural).

- Part of the pass: replacing concatenated fragments with one template per sentence and per plural form at the call site, splitting a key shared by call sites that need different words, adding a key and its row in every language, extending the lookup that applies the strings so it also fills translated attributes such as placeholders and accessible names, and giving an icon-only control its accessible name.
- A key that the pass's own split or template leaves with no call site is removed from every language in the same pass, and the report lists each removed key by name. A key that was already unused before the pass is left in place and listed for the owner, since something outside the target may still read it.
- Not part of the pass unless the request includes code: new visible elements such as a label that replaces a placeholder, new controls, new files, and any change of behaviour. Each is listed as an open item with the rule that asks for it.

## The voice file

One rule for every pass: a pass reads the voice file, `docs/voice.md` or a Voice section of the project's rules file, when one exists, and creates it only when the request asks for a voice or for a new product. Every other pass, a rewrite across categories included, takes the option values from the category defaults and [essentials.md](essentials.md#defaults), lists the values it used in its report, and lists the missing voice file as an open item. [voice-specification](protocols/voice-specification.md) and [bilingual-copy](protocols/bilingual-copy.md) step 1 follow the same rule.

## When the whole target is inside

A target that is entirely untouchable is reported as such and left alone. A target that is entirely filler-only gets the filler pass and nothing else. Both still report their signals from [measures.md](measures.md), so the reader can see that nothing moved.
