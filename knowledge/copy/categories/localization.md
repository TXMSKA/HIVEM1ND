# Bilingual and localized copy

Any text that ships in more than one language, and any code that stores or displays translated text. This category composes with every other one: a button in two languages is both a button and a bilingual string. Its protocols are in the [routing table](../INDEX.md#routing).

## Authoring both columns

Applies when: a new string in a product with more than one language, a resource or messages file, "translate this", a string that exists in one language only.

Build: one row per key with every language filled in the same sitting; keys in English; for a fixed container, the longer language first.

Options: the base language declared once in the voice file; the longer language first only for fixed containers.

Open: [bilingual.md, Declare the base](../bilingual.md#declare-the-base), [Write both, do not translate one](../bilingual.md#write-both-do-not-translate-one) and [Expansion](../bilingual.md#expansion).

## Register and address

Applies when: Spanish or another language with several forms of address, "the Spanish sounds regional", a mix of forms of address across screens.

Build: the register from the voice file applied to every sentence, *se* or the third person in descriptions (*Se guarda al instante*), infinitives on buttons and instructions (*Guardar factura*), no form of address to the reader (*Hola de nuevo* as a greeting), then a re-read of every string for register, voseo and tuteo included.

Options: the Spanish register values in [options.md](../options.md#spanish-register), neutral impersonal by default.

Open: [bilingual.md, Register](../bilingual.md#register) and [Spanish conventions](../bilingual.md#spanish-conventions).

## Templates and plurals

Applies when: a message built with string concatenation, a count in a sentence, a noun inserted at runtime, a bare fragment label.

Build: one whole sentence per language with named placeholders, one string per plural form: `{count} invoice is unpaid` and `{count} invoices are unpaid`; the call site passes the values and joins nothing, and is changed in the same pass.

Options: a verb added to short labels on controls that act (filters, toggles, commands), never to navigation, statuses or column headers.

Open: [bilingual.md, Templates, never concatenation](../bilingual.md#templates-never-concatenation) and [Add the verb to short labels](../bilingual.md#add-the-verb-to-short-labels).

## Keys, identifiers and stored text

Applies when: a translation call whose result is saved, a route or id in the content language, a column or category name stored as text, a string intentionally left untranslated.

Build: store the key and resolve it at render; identifiers in English; each string kept in one language listed on the voice file's one-language list.

Options: none; a name the person typed is stored and shown as typed.

Open: [bilingual.md, Store keys, not translated text](../bilingual.md#store-keys-not-translated-text) and [What never translates](../bilingual.md#what-never-translates).

## Right-to-left text

Applies when: the product ships Arabic, Hebrew, Persian or Urdu; a right-to-left string carries a placeholder, a number or a brand name; punctuation lands at the wrong end of a line.

Build: each placeholder and each part whose direction may differ isolated with `bdi`, or the isolate characters where markup cannot go; the language's own punctuation; strings stored in reading order, never reversed by hand; the direction and the parts that stay left to right in the key's note.

Options: none for the words; the mirrored layout is the design module's [writing direction](../../design/categories/foundations.md#writing-direction).

Open: [bilingual.md, Right-to-left languages](../bilingual.md#right-to-left-languages).
