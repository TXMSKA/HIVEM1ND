# Inputs and controls

Single controls a person types into or sets: text fields, selects, checkboxes, radios, toggles, dates, numbers, search, file uploads and rich-text editors. How they combine into a form is in the [forms category](forms.md).

## Text input

Applies when: a text, email, password, phone or code field is added or restyled; a label is missing or a placeholder stands in for it; a helper sentence sits under a field; a phone zooms when the field is focused.

Build: A `label` tied by `for` above each field, the matching `type`, `inputmode` and `autocomplete`, a font size of 16 CSS pixels or more on phones and touch, 44 pixels high on touch, a border at 3:1 when the border alone tells the field apart (a 3:1 bottom rule at rest for text edited in place), and errors tied by `aria-describedby`. When a design pass finds only a placeholder, it writes the visible label from it and flags it for the copy pass, which reviews the words.

Options:

- **Label above, nothing below** until something is wrong: the default.
- **Format inside the label** when the person must know it before typing, such as the order of a date.
- **Live indicator** for a rule that is easier to meet while typing, such as password strength.
- **Password field with a visibility toggle**; **code input** that accepts a pasted code whole.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), steps 2 and 8; [forms-and-controls.md, Fields](../forms-and-controls.md#fields).

## Select and menu of options

Applies when: a dropdown, combobox, multi-select or option menu is added; a list has more than ten rows; a menu is clipped or opens off screen; a request says "the dropdown is annoying".

Build: Count the options and pick by the table in [forms-and-controls.md](../forms-and-controls.md#choosing-the-control): a radio group up to five, a select from six to ten, a filtered menu above ten. A native `select` with an explicit background and text colour from the tokens, the chevron at the right edge, as wide as its column and as tall as the other fields, and the open list in the theme's colours through `color-scheme`; a filtered menu mounted where no ancestor clips it. Every select is opened and checked where it runs, all of them when one changes.

Options:

- **A multi-select that stays open**, with checkboxes, a live count and Done.
- **Cards** when the choice is between content types.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), steps 1, 3 and 4; [forms-and-controls.md, Choosing the control](../forms-and-controls.md#choosing-the-control) and [Menus and selects](../forms-and-controls.md#menus-and-selects).

## Checkbox, radio and segmented control

Applies when: options are presented as boxes, circles or a segmented bar; a set of five or fewer options is hidden in a dropdown; the current choice is not visible.

Build: Native inputs inside a `fieldset` with a `legend`, each option a `label` at least 44 pixels high. A segmented control is a radio group styled as joined buttons, up to five short options, the selected one marked by surface and border as well as colour.

Options:

- **Radios** for one choice with visible labels, stacked when labels are long.
- **Segmented control** for one choice among short options that switch a view or a mode.
- **Checkboxes** for several independent choices, or one agreement.

Open: [forms-and-controls.md, Choosing the control](../forms-and-controls.md#choosing-the-control); [accessibility](../protocols/accessibility.md), step 4.

## Toggle

Applies when: a switch is added; a setting applies immediately or on save.

Build: A `button` with `role="switch"` and `aria-checked`, its label beside it, the setting applied at once, and the thumb moving at the press duration in [animation.md](../animation.md#numbers).

Options:

- **Toggle switch** for a setting that takes effect at once.
- **Checkbox** for an option inside a form that is saved later.

Open: [forms-and-controls.md, Choosing the control](../forms-and-controls.md#choosing-the-control).

## Date and number

Applies when: a date, a range, a time, a quantity or a price is entered; a picker moves one month per press; a slider hides the exact value.

Build: A native date input for dates near today, a text field that parses the local order for known dates. Amounts take `inputmode="decimal"` and are normalized on blur; codes and money never use a number input, whose spinner and rounding do not fit them.

Options:

- **Typed date with a year jump** for known dates such as a birthday.
- **Calendar picker** for dates near today, with typing still accepted; ranges show both ends at once.
- **Stepper** for a small whole number; **slider** when position matters more than the exact value; **plain numeric field** with the numeric keyboard otherwise.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), step 3; [forms-and-controls.md, Dates](../forms-and-controls.md#dates).

## Search

Applies when: a search field is added, results appear, a query returns nothing, or a site grows past what navigation reaches in two steps.

Build: A search input with a visible label, results as the person types debounced 200 to 300 milliseconds, the result count in a status region, the query kept on the results, and a no results state with a clear action.

Options:

- **Search as the person types** once the response is fast enough, with input debounced.
- **Search on submit** when each query is expensive.
- **A site search** once navigation alone cannot reach a page in two steps; a shortcut that focuses it shown next to the field.

Open: [forms-and-controls.md, Search](../forms-and-controls.md#search); [states.md, Empty](../states.md#empty); [site-polish.md, Build first](../site-polish.md#build-first).

## File upload and drop zone

Applies when: a file, image or document is attached, imported or uploaded; a drop zone is added; an upload fails or hangs without saying so.

Build: A native `input type="file"` with a visible label naming the accepted types and the size limit, and `accept` to match; a drop zone around it as an enhancement; each file a row with its name, size, a determinate progress bar and a remove control; a failed file kept with its cause and a retry; progress and success in a status region, failures in an alert region; type and size enforced on the server, as [forms-and-controls.md](../forms-and-controls.md#file-upload) sets out.

Options:

- **One file input** for a single attachment.
- **A list of files with a drop zone** for repeated or bulk uploads.
- **A resumable upload straight to storage** for large files, so a dropped connection does not restart it.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), steps 2, 6 and 7; [forms-and-controls.md, File upload](../forms-and-controls.md#file-upload).

## Rich-text editor

Applies when: a comment box, a description, a document or a message gets formatting; a toolbar is added to a text field; pasted text brings its own fonts.

Build: The lightest editor that does the job, from a maintained library; a visible label tied to the editable region; a toolbar that is one keyboard stop with named buttons and their state in `aria-pressed`; paste cleaned to the supported formats; saving as long text does; stored HTML sanitized on the server, as [forms-and-controls.md](../forms-and-controls.md#rich-text-editor) sets out.

Options:

- **A plain text area** when formatting adds nothing.
- **Markdown with a preview** for technical readers.
- **A rich editor** when people format, with the formats limited to the ones the product renders.

Open: [accessibility](../protocols/accessibility.md), steps 1 and 2; [forms-and-controls.md, Rich-text editor](../forms-and-controls.md#rich-text-editor) and [Saving and settings](../forms-and-controls.md#saving-and-settings).
