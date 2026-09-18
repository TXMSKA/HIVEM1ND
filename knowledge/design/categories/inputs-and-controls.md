# Inputs and controls

Single controls a person types into or sets: text fields, selects, checkboxes, radios, toggles, dates, numbers and search. How they combine into a form is in [forms.md](forms.md).

## Text input

Applies when: a text, email, password, phone or code field is added or restyled; a label is missing or a placeholder stands in for it; a helper sentence sits under a field; a phone zooms when the field is focused.

Options:

- **Label above, nothing below** until something is wrong: the default.
- **Format inside the label** when the person must know it before typing, such as the order of a date.
- **Live indicator** for a rule that is easier to meet while typing, such as password strength.
- **Password field with a visibility toggle**; **code input** that accepts a pasted code whole.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), steps 2 and 8; [forms-and-controls.md](../forms-and-controls.md), Fields.

## Select and menu of options

Applies when: a dropdown, combobox, multi-select or option menu is added; a list has ten or more rows; a menu is clipped or opens off screen; a request says "the dropdown is annoying".

Options:

- **Radios or a segmented control** for two to four stable options.
- **A select** for five to about ten options.
- **A filtered menu** for ten or more, with the filter focused on open and a no results state.
- **A multi-select that stays open**, with checkboxes, a live count and Done.
- **Cards** when the choice is between content types.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), steps 1, 3 and 4; [forms-and-controls.md](../forms-and-controls.md), Choosing the control, Menus and selects.

## Checkbox, radio and segmented control

Applies when: options are presented as boxes, circles or a segmented bar; a set of options is hidden in a dropdown; the current choice is not visible.

Options:

- **Radios** for one choice with visible labels, stacked when labels are long.
- **Segmented control** for one choice among two to four short options that switch a view or a mode.
- **Checkboxes** for several independent choices, or one agreement.

Open: [forms-and-controls.md](../forms-and-controls.md), Choosing the control; [accessibility](../protocols/accessibility.md), step 4.

## Toggle

Applies when: a switch is added; a setting applies immediately or on save.

Options:

- **Toggle switch** for a setting that takes effect at once.
- **Checkbox** for an option inside a form that is saved later.

Open: [forms-and-controls.md](../forms-and-controls.md), Choosing the control; [animation.md](../animation.md), Numbers, for the switch motion.

## Date and number

Applies when: a date, a range, a time, a quantity or a price is entered; a picker moves one month per press; a slider hides the exact value.

Options:

- **Typed date with a year jump** for known dates such as a birthday.
- **Calendar picker** for dates near today, with typing still accepted; ranges show both ends at once.
- **Stepper** for a small whole number; **slider** when position matters more than the exact value; **plain numeric field** with the numeric keyboard otherwise.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), step 3; [forms-and-controls.md](../forms-and-controls.md), Dates.

## Search

Applies when: a search field is added, results appear, a query returns nothing, or a site grows past what navigation reaches in two steps.

Options:

- **Search as the person types** once the response is fast enough, with input debounced.
- **Search on submit** when each query is expensive.
- **A site search** once navigation alone cannot reach a page in two steps; a shortcut that focuses it shown next to the field.

Open: [forms-and-controls.md](../forms-and-controls.md), Search; [states.md](../states.md), Empty; [site-polish.md](../site-polish.md), Build first.
