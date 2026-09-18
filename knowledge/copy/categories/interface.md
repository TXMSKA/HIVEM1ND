# Interface microcopy

Strings inside a control or next to one, read in passing while doing something else. Defaults for the whole category: Plain tone, fragment length, sentence case, dash policy none, no emoji (see [options.md](../options.md)). Its protocols are in the [routing table](../INDEX.md#routing).

## Buttons and controls

Applies when: "rename this button", "the button says Submit", a diff that changes the text of a button, a link that performs an action, a toggle, a segmented control or a destructive action.

Options: no person, verb and object, four words at most. A destructive action always names its object, whatever length that costs. Contractions and casing follow the project.

Build: the verb of what happens, then the object in the words of the heading it acts on: *Save invoice*, *Send reminder*, *Delete invoice*. A toggle label names the setting, not the action: *Email reminders*.

Open: [microcopy.md, Buttons and controls](../microcopy.md#buttons-and-controls).

## Labels

Applies when: a form field is added or renamed, a card or metric gets a title, a table column header changes, "this field name is confusing".

Options: a noun phrase in the words the person uses, no person, no period. When a hint seems needed, rename the label first.

Build: the noun the person uses for the value, taken from the word table of the voice file: *Due date*, *Client email*. One name per object on every screen.

Open: [microcopy.md, Labels](../microcopy.md#labels).

## Placeholders

Applies when: a diff adds or changes placeholder text, or a field has a placeholder and no visible label.

Options: none by default; an example of the format only when the format is not obvious.

Build: leave the field without one. Add one only as a format example the label cannot carry: *name@example.com*, *2026-09-18*.

Open: [microcopy.md, Placeholders](../microcopy.md#placeholders).

## Helper text

Applies when: a sentence is printed under a field or a heading, "add a hint", a subheading under a heading, a password or format rule shown before typing.

Options: none by default. A constraint that matters before typing becomes a live indicator; one that matters after becomes the error.

Build: none. A rule that matters while typing becomes a live indicator (*8 characters or more*, ticked as it is met); a rule that matters after becomes the error.

Open: [microcopy.md, Helper text](../microcopy.md#helper-text), and [microcopy.md, Errors](../microcopy.md#errors) for the constraint that moves there.

## Tooltips

Applies when: a diff adds a title attribute, a tooltip or a hover hint, or an icon-only control gets an accessible name.

Options: one fragment or one sentence, no person. Never the only place of essential information.

Build: the accessible name of an icon-only control is the verb and object its button would have: *Close dialog*, *Delete invoice*. A tooltip adds one fact the screen does not show, or is not written.

Open: [microcopy.md, Tooltips](../microcopy.md#tooltips).

## Navigation and menus

Applies when: a navigation item, a tab, a menu entry or a breadcrumb is added or renamed, or two screens call the same place by different names.

Options: nouns for places, verbs for actions, fragment length, the same words as the destination heading. A navigation item stays a noun in every language; the verb rule for short labels in localization applies to controls, not places.

Build: the noun of the place, equal to the heading of the page it opens: *Invoices* opens *Invoices*. Menu commands are verbs: *Export PDF*. Order by frequency of use.

Open: [microcopy.md, Navigation and menus](../microcopy.md#navigation-and-menus).
