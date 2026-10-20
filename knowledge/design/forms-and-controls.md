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
| Up to five stable options, one choice | A radio group, or a segmented control when the labels are short, never a dropdown: one tap, nothing hidden, the current value always visible |
| A few options, several choices | Checkboxes |
| One setting that takes effect at once | A toggle switch |
| One agreement or one option inside a form that is saved later | A checkbox |
| Six to ten options | A select or a menu |
| More than ten options | A menu with a filter field on top |
| Picking many items from a long list | A multi-select that stays open, with checkboxes |
| Choosing between content types | A set of cards with an icon, a name and one line each, never a select |
| A date that is known, such as a birthday | A typed field that parses the local format, with a picker as a helper |
| A date near today, such as a booking | A calendar picker, with typing still accepted |
| A number with a small range | A stepper; a slider only when the exact value matters less than the position |
| A one-time code | A dedicated code input that accepts a pasted code whole |

## Menus and selects

- **Type to filter above ten rows.** Any list of more than ten items gets a search field on top, focused when the menu opens. The list narrows as the person types, and an empty result shows a no results state instead of a blank panel, as in [states.md](states.md#empty). Applies to country, person, tag, product and permission selects.
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

**Reasons, not grey.** A disabled primary action is allowed only with a visible reason next to it; otherwise it stays enabled and validates on submit. The reason says what is missing and what unlocks it, and the unblocking action is one step away: a disabled Save reads "Complete the email to continue" and moves focus to that field. The same holds for every critical control, not only submit, as in [states.md](states.md#disabled).

## Validation and submission

- **Validate a field when the person leaves it**, not on every keystroke while it is still being typed, and clear the error as soon as the value becomes valid.
- **Errors sit inline next to their field**, name the problem and the fix, and are tied to the field so assistive technology reads them with it. On submit, focus moves to the first error, and a summary lists the errors when the form is long.
- **An error never erases what was typed.**
- **Submit shows it is working.** The button keeps its label, gains a spinner and refuses a second submission while the request runs.
- **Success is a state, not a reset.** The form confirms what happened and what comes next.
- **Unsaved changes are protected.** Navigating away from a changed form asks first, and Back, Forward and a reload bring the typed values back: a long form keeps a draft in session storage until the submission succeeds, and a failed request never rebuilds the form empty.
- **A form is only as long as it needs to be.** Each field removed takes away one reason to abandon the form.

## Layout and flow

- One column for a form that is filled top to bottom. Two fields share a row only when they are read as one thing, such as a first and a last name, or a city and a postcode.
- Related fields are grouped under a short heading, with the space between groups larger than the space inside them.
- The primary action sits at the end of the reading path, aligned with the fields, and a secondary action is visibly weaker.
- **Multi step** only when the steps are genuinely separate decisions. Each step shows where the person is and how many remain, keeps what was entered when going back, and saves progress when the form is long enough that losing it would hurt. The step names are verbs that say what happens, not numbers alone.
- **The keyboard never covers the field being typed in.** On a phone the focused field and its error stay in view above the on-screen keyboard, the submit is one scroll away, a fixed bottom bar moves up or yields while the keyboard is open, and a full-height container is sized in `dvh`, not `vh`.
- On a redesign, field names and field order do not change silently: analytics and autofill depend on them.

## Honest choices

- **Nothing is chosen for the person.** Consent, marketing mail, add-ons, a higher plan and a donation start unticked or off: the default is the option that costs and shares least.
- **Decline equals accept.** Same size, weight and place, one press each. A refusal worded to shame the person, or hidden in a link under a bright button, is a trick.
- **Urgency and scarcity are real.** A timer, "only 2 left" or "12 people are viewing" comes from a deadline or a count in the data, never from a random number or a clock that restarts.
- **Leaving is as easy as joining.** Cancel, unsubscribe and delete account sit where the person looks, in no more presses than sign-up took, and a refused prompt does not return in the same session.
- **The price is the price.** Fees, taxes, shipping and the renewal price show before the last press, and the amount charged equals the amount shown.

## File upload

- **A native file input is the way in.** A visible label and a button that opens the file picker; a drop zone is an enhancement around it, never the only route, because dragging is unavailable on touch and from the keyboard.
- **The limits are part of the label**, such as "Invoice, PDF or PNG, up to 10 MB", and `accept` matches them.
- **The drop zone answers.** On drag over it shows a stronger border and a word; a file dropped beside it is ignored rather than opened by the browser.
- **Each file is a row**: its name, its size, a determinate progress bar and a remove control. A failed file keeps its row with the cause and a retry, and the other files carry on.
- **The form stays usable while files upload**, and submit waits for them or names what it waits for.
- **The server decides.** Type and size checks in the page are hints: the server decides the type by content and caps the size, as steps 1 and 5 of the security module's file-upload protocol prove. When that module is not installed, this line is the rule.

## Saving and settings

- **One saving model per screen.** A toggle or a single choice applies on change; long text and editors save on their own after a pause in typing and on blur; fields validated together, or a change that costs money, wait for one Save button at the end of their section.
- **Saving on its own shows its state** in one line near the title, in a status region: saving, saved, or not saved with the cause and a retry. Nothing else moves.
- **A failed save keeps the value** in the field and on the device, and never reverts silently.
- **Settings are grouped** under short headings, the most used first, each setting its label and its control. Destructive settings, such as deleting the account, sit last in a section of their own behind a confirmation.

## Rich-text editor

- **The lightest editor that does the job.** A text area when formatting adds nothing, Markdown with a preview for technical readers, a rich editor only when people format.
- **A maintained editor library, not a hand-rolled editable region**, which loses undo, selection and paste handling.
- **The editable region has a name**: a visible label tied to it, and `role="textbox"` with `aria-multiline="true"` when it is not a native text area.
- **The toolbar is one keyboard stop**: `role="toolbar"` with a label, arrow keys between its buttons, each button named with its state in `aria-pressed`, and the shortcuts for bold, italic and link shown in the tooltips.
- **Paste is cleaned** to the formats the editor supports, so pasted fonts and colours do not arrive.
- **It saves like any long text**, as in Saving and settings.
- **Stored HTML is sanitized on the server** against an allow-list of tags and attributes before it is stored and before it is rendered, as step 4 of the security module's injection-and-output protocol proves. When that module is not installed, this line is the rule.

## Never

- A date picker that only offers previous and next month.
- A critical control disabled without a message and a next step.
- A list of more than ten rows without a live filter.
- A multi-select that closes on the first click.
- A dropdown clipped by a parent's overflow or cut off by the viewport edge.
- A dropdown for five options or fewer.
- A helper sentence under every field.
- A box ticked for the person, or a decline smaller than its accept.

## Audit order

On an existing form, fix in cost order. First the typeable date with a year jump, the filter on long selects and the disabled controls without a reason. Then the multi-selects that close on pick and the clipped dropdowns. Last, the dropdowns of five options or fewer.
