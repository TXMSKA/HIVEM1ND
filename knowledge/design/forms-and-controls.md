# Forms and controls

A form is a task with a cost in taps and seconds, and a menu is a decision made with the fewest taps possible. Every control that adds presses, or hides why it is blocked, pushes the person toward abandoning the task. Design for the long list, the multi-select and the small viewport, not for the happy case of six options and plenty of room below. The checks run in [forms-and-inputs](protocols/forms-and-inputs.md).

## Fields

- **A visible label above every field, and the label is enough.** A field called "Password again" already says what it is for. No explanatory sentence sits under a field or under a heading before anybody has done anything wrong: it adds reading, not understanding.
- **Constraints appear when they matter.** A rule such as a minimum length or an allowed character set shows in the error the field raises, or in an indicator that reacts as the person types. A format the person must know before typing, such as the order of a date, is part of the label itself, so the requirement is visible without a helper line.
- **The placeholder is never the label.** It disappears on the first keystroke, and its contrast is held to 4.5:1 like any text.
- **The field fits its content.** A postcode field is short, an address field is long. The width is a hint about the answer.
- **The right keyboard and the right autofill.** Input type, input mode and autocomplete tokens match the data, so a phone shows the numeric pad for a code and the browser fills a known address.
- **Input font at 16 CSS pixels or more**, so a phone browser does not zoom the page when the field takes focus.
- **Accept what people type.** Spaces in a card number, a date written in the local order, an email with a trailing space: the input is normalized, not refused.
- **Password fields have a visibility toggle.**

## Choosing the control

| Situation | Control |
| --- | --- |
| Two to four stable options, one choice | Radios or a segmented control, never a dropdown: one tap, nothing hidden, the current value always visible |
| Two to four options, several choices | Checkboxes |
| One setting that takes effect at once | A toggle switch |
| One agreement or one option inside a form that is saved later | A checkbox |
| Five to about ten options | A select or a menu |
| About ten options or more | A menu with a filter field on top |
| Picking many items from a long list | A multi-select that stays open, with checkboxes |
| Choosing between content types | A set of cards with an icon, a name and one line each, never a select |
| A date that is known, such as a birthday | A typed field that parses the local format, with a picker as a helper |
| A date near today, such as a booking | A calendar picker, with typing still accepted |
| A number with a small range | A stepper; a slider only when the exact value matters less than the position |
| A one-time code | A dedicated code input that accepts a pasted code whole |

## Menus and selects

- **Type to filter above ten rows.** Any list of about ten items or more gets a search field on top, focused when the menu opens. The list narrows as the person types, and an empty result shows a no results state instead of a blank panel, as in [states.md](states.md). Applies to country, person, tag, product and permission selects.
- **A multi-select stays open on pick.** Checkboxes, a live count of the selected items and an explicit Done button that closes it. Picking five items never means opening the menu five times.
- **Render in a portal and flip.** The panel mounts outside any ancestor that clips its overflow and opens upward when there is no room below, so it stays usable near the bottom edge and on a small viewport.
- **The panel stays anchored to its trigger.** It opens next to the control that opened it, grows from that control, and repositions on scroll and resize instead of floating loose.
- **Keyboard complete.** Arrow keys move, typing jumps to a match, enter selects, escape closes and returns focus to the trigger.

## Dates

- **Typed, not only tapped.** A text field parses the date in the local order, and the picker jumps by month and by year, never one month per arrow only. A picker that opens on today and moves one month per press costs close to four hundred presses to reach a birthday thirty years back, and people abandon the form instead of paying them.
- **Ranges show both ends at once** and let the second click set the end rather than restart.

## Search

- A search field on a page opens with the query visible and editable, shows results as the person types once the response is fast enough, and keeps the query visible on the results.
- A search with no results says what was searched, offers to widen or clear it, and never shows a blank panel.
- A keyboard shortcut that focuses search is shown next to the field.

## Disabled controls

**Reasons, not grey.** A disabled control says inline what is missing and what unlocks it, and the unblocking action is one step away: a disabled Save reads "Complete the email to continue" and moves focus to that field. A disabled primary action is valid when that inline reason is present. It applies to every critical control, not only submit.

## Validation and submission

- **Validate a field when the person leaves it**, not on every keystroke while it is still being typed, and clear the error as soon as the value becomes valid.
- **Errors sit inline next to their field**, name the problem and the fix, and are tied to the field so assistive technology reads them with it. On submit, focus moves to the first error, and a summary lists the errors when the form is long.
- **An error never erases what was typed.**
- **Submit shows it is working.** The button keeps its label, gains a spinner and refuses a second submission while the request runs.
- **Success is a state, not a reset.** The form confirms what happened and what comes next.
- **Unsaved changes are protected.** Navigating away from a changed form asks first.
- **A form is only as long as it needs to be.** Every field removed is a reason to abandon removed.

## Layout and flow

- One column for a form that is filled top to bottom. Two fields share a row only when they are read as one thing, such as a first and a last name, or a city and a postcode.
- Related fields are grouped under a short heading, with the space between groups larger than the space inside them.
- The primary action sits at the end of the reading path, aligned with the fields, and a secondary action is visibly weaker.
- **Multi step** only when the steps are genuinely separate decisions. Each step shows where the person is and how many remain, keeps what was entered when going back, and saves progress when the form is long enough that losing it would hurt. The step names are verbs that say what happens, not numbers alone.
- On a redesign, field names and field order do not change silently: analytics and autofill depend on them.

## Never

- A date picker that only offers previous and next month.
- A critical control disabled without a message and a next step.
- A list of more than ten rows without a live filter.
- A multi-select that closes on the first click.
- A dropdown clipped by a parent's overflow or cut off by the viewport edge.
- A dropdown for two to four options.
- A helper sentence under every field.

## Audit order

On an existing form, fix in cost order. First the typeable date with a year jump, the filter on long selects and the disabled controls without a reason. Then the multi-selects that close on pick and the clipped dropdowns. Last, the dropdowns under five options.
