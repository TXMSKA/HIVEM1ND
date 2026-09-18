# Inputs and controls

Single controls a person types into or sets: text fields, selects, checkboxes, radios, toggles, dates, numbers and search. How they combine into a form is in the [forms category](forms.md).

## Text input

Applies when: a text, email, password, phone or code field is added or restyled; a label is missing or a placeholder stands in for it; a helper sentence sits under a field; a phone zooms when the field is focused.

Options:

- **Label above, nothing below** until something is wrong: the default.
- **Format inside the label** when the person must know it before typing, such as the order of a date.
- **Live indicator** for a rule that is easier to meet while typing, such as password strength.
- **Password field with a visibility toggle**; **code input** that accepts a pasted code whole.

Build: A `label` tied by `for` above each field, the matching `type`, `inputmode` and `autocomplete`, a font size of 16 CSS pixels or more, 44 pixels high on touch, a border at 3:1, and errors tied by `aria-describedby`. When a design pass finds only a placeholder, it writes the visible label from it.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), steps 2 and 8; [forms-and-controls.md](../forms-and-controls.md), Fields.

## Select and menu of options

Applies when: a dropdown, combobox, multi-select or option menu is added; a list has ten or more rows; a menu is clipped or opens off screen; a request says "the dropdown is annoying".

Options:

- **Radios or a segmented control** for two to four stable options.
- **A select** for five to about ten options.
- **A filtered menu** for ten or more, with the filter focused on open and a no results state.
- **A multi-select that stays open**, with checkboxes, a live count and Done.
- **Cards** when the choice is between content types.

Build: Count the options and pick by the table in [forms-and-controls.md](../forms-and-controls.md). A native `select` for five to about ten, with an explicit background and text colour from the tokens; a filtered menu past ten, mounted where no ancestor clips it.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), steps 1, 3 and 4; [forms-and-controls.md](../forms-and-controls.md), Choosing the control, Menus and selects.

## Checkbox, radio and segmented control

Applies when: options are presented as boxes, circles or a segmented bar; a set of options is hidden in a dropdown; the current choice is not visible.

Options:

- **Radios** for one choice with visible labels, stacked when labels are long.
- **Segmented control** for one choice among two to four short options that switch a view or a mode.
- **Checkboxes** for several independent choices, or one agreement.

Build: Native inputs inside a `fieldset` with a `legend`, each option a `label` at least 44 pixels high. A segmented control is a radio group styled as joined buttons, the selected one marked by surface and border as well as colour.

Open: [forms-and-controls.md](../forms-and-controls.md), Choosing the control; [accessibility](../protocols/accessibility.md), step 4.

## Toggle

Applies when: a switch is added; a setting applies immediately or on save.

Options:

- **Toggle switch** for a setting that takes effect at once.
- **Checkbox** for an option inside a form that is saved later.

Build: A `button` with `role="switch"` and `aria-checked`, its label beside it, the setting applied at once, and the thumb moving in 100 to 160 milliseconds.

Open: [forms-and-controls.md](../forms-and-controls.md), Choosing the control; [animation.md](../animation.md), Numbers, for the switch motion.

## Date and number

Applies when: a date, a range, a time, a quantity or a price is entered; a picker moves one month per press; a slider hides the exact value.

Options:

- **Typed date with a year jump** for known dates such as a birthday.
- **Calendar picker** for dates near today, with typing still accepted; ranges show both ends at once.
- **Stepper** for a small whole number; **slider** when position matters more than the exact value; **plain numeric field** with the numeric keyboard otherwise.

Build: A native date input for dates near today, a text field that parses the local order for known dates. Amounts take `inputmode="decimal"` and are normalized on blur; codes and money never use a number input, whose spinner and rounding do not fit them.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), step 3; [forms-and-controls.md](../forms-and-controls.md), Dates.

## Search

Applies when: a search field is added, results appear, a query returns nothing, or a site grows past what navigation reaches in two steps.

Options:

- **Search as the person types** once the response is fast enough, with input debounced.
- **Search on submit** when each query is expensive.
- **A site search** once navigation alone cannot reach a page in two steps; a shortcut that focuses it shown next to the field.

Build: A search input with a visible label, results as the person types debounced 200 to 300 milliseconds, the result count in a status region, the query kept on the results, and a no results state with a clear action.

Open: [forms-and-controls.md](../forms-and-controls.md), Search; [states.md](../states.md), Empty; [site-polish.md](../site-polish.md), Build first.
