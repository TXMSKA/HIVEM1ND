# Interface microcopy

Strings inside a control or next to one, read in passing while doing something else. Defaults for the whole category: Plain tone, fragment length, sentence case, dash policy none, no emoji (see [options.md](../options.md)). Its protocols are in the [routing table](../INDEX.md#routing).

## Buttons and controls

Applies when: "rename this button", "the button says Submit", a diff that changes the text of a button, a link that performs an action, a toggle, a segmented control or a destructive action.

Build: the verb of what happens, then the object in the words of the heading it acts on: *Save invoice*, *Send reminder*, *Delete invoice*. A toggle label names the setting, not the action: *Email reminders*.

Options: no person, fragment length; contractions and casing as the project decides them.

Open: [microcopy.md, Buttons and controls](../microcopy.md#buttons-and-controls).

## Labels

Applies when: a form field is added or renamed, a card or metric gets a title, a table column header changes, "this field name is confusing".

Build: the noun the person uses for the value, taken from the word table of the voice file: *Due date*, *Client email*. One name per object on every screen.

Options: a noun phrase, no person, no period; when a hint seems needed, a renamed label before any hint.

Open: [microcopy.md, Labels](../microcopy.md#labels).

## Placeholders

Applies when: a diff adds or changes placeholder text, or a field has a placeholder and no visible label.

Build: leave the field without one. Add one only as a format example the label cannot carry: *name@example.com*, *2026-09-18*. A label that replaces a placeholder comes from the design pass; this pass reviews its words.

Options: none by default; an example of the format only when the format is not obvious.

Open: [microcopy.md, Placeholders](../microcopy.md#placeholders).

## Helper text

Applies when: a sentence is printed under a field or a heading, "add a hint", a subheading under a heading, a password or format rule shown before typing.

Build: none. A rule that matters while typing becomes a live indicator (*8 characters or more*, ticked as it is met); a rule that matters after becomes the error.

Options: none by default; a static line only for a constraint that cannot be shown live, with the reason recorded.

Open: [microcopy.md, Helper text](../microcopy.md#helper-text) and [Errors](../microcopy.md#errors) for the constraint that moves there.

## Tooltips

Applies when: a diff adds a title attribute, a tooltip or a hover hint, or an icon-only control gets an accessible name.

Build: the accessible name of an icon-only control is the verb and object its button would have: *Close dialog*, *Delete invoice*. A tooltip adds one fact the screen does not show, or is not written.

Options: one fragment or one sentence, no person.

Open: [microcopy.md, Tooltips](../microcopy.md#tooltips).

## Navigation and menus

Applies when: a navigation item, a tab, a menu entry or a breadcrumb is added or renamed, or two screens call the same place by different names.

Build: the noun of the place, equal to the heading of the page it opens: *Invoices* opens *Invoices*. Menu commands are verbs: *Export PDF*. Order by frequency of use.

Options: nouns for places and verbs for actions, fragment length, in every language.

Open: [microcopy.md, Navigation and menus](../microcopy.md#navigation-and-menus).

## Alternative text

Applies when: an image, a chart, an icon-only link or an image of text is added; an `alt` attribute is empty, missing or reads "image".

Build: what the image shows or does here, in a fragment or one sentence: *Revenue rose 12 percent from June to July* for a chart, *Home* for a linked logo, an empty `alt` for a decorative image.

Options: no person, fragment or one sentence; a chart or diagram adds its data in the page or a linked table.

Open: [microcopy.md, Alternative text](../microcopy.md#alternative-text).
