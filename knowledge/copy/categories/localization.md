# Bilingual and localized copy

Any text that ships in more than one language, and any code that stores or displays translated text. This category composes with every other one: a button in two languages is both a button and a bilingual string. Every subcategory runs [bilingual-copy](../protocols/bilingual-copy.md).

## Authoring both columns

Applies when: a new string in a product with more than one language, a resource or messages file, "translate this", a string that exists in one language only.

Options: base language declared once; both columns written in the same pass; the longer language first for fixed containers.

Open: [bilingual.md, Declare the base](../bilingual.md#declare-the-base), [bilingual.md, Write both, do not translate one](../bilingual.md#write-both-do-not-translate-one) and [bilingual.md, Expansion](../bilingual.md#expansion).

## Register and address

Applies when: Spanish or another language with several forms of address, "the Spanish sounds regional", a mix of forms of address across screens.

Options: the Spanish register option in [options.md](../options.md), neutral tú by default for public copy across regions, infinitives on buttons and menu items.

Open: [bilingual.md, Register](../bilingual.md#register) and [bilingual.md, Spanish conventions](../bilingual.md#spanish-conventions).

## Templates and plurals

Applies when: a message built with string concatenation, a count in a sentence, a noun inserted at runtime, a bare fragment label.

Options: whole sentences with named placeholders, one string per plural form, a verb added to short labels.

Open: [bilingual.md, Templates, never concatenation](../bilingual.md#templates-never-concatenation) and [bilingual.md, Add the verb to short labels](../bilingual.md#add-the-verb-to-short-labels).

## Keys, identifiers and stored text

Applies when: a translation call whose result is saved, a route or id in the content language, a column or category name stored as text, a string intentionally left untranslated.

Options: store the key and translate at render; identifiers always in English; one-language strings listed in the rules file.

Open: [bilingual.md, Store keys, not translated text](../bilingual.md#store-keys-not-translated-text) and [bilingual.md, What never translates](../bilingual.md#what-never-translates).
