# Forms

Fields combined into a task: sign-up, checkout, contact, settings, editors. The controls themselves are in the [inputs-and-controls category](inputs-and-controls.md).

## Layout

Applies when: a form is created or rearranged; fields sit in several columns; a request says "the form is long" or "the form looks messy".

Build: One column about 40rem wide, related fields in a `fieldset` with a `legend` as its heading, more space between groups than inside them, the primary action last and aligned with the fields. On a phone the focused field scrolls clear of the on-screen keyboard and of any fixed bar.

Options:

- **One column**, the default for a form filled top to bottom.
- **Paired fields on one row** only when they are read as one thing, such as a first and a last name.
- **Grouped sections with short headings** for long forms.
- **Inline editing** instead of a form in a modal when the person is changing one value in place.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), step 1; [forms-and-controls.md, Layout and flow](../forms-and-controls.md#layout-and-flow); [ux-laws.md, Grouping and form](../ux-laws.md#grouping-and-form).

## Validation and errors

Applies when: rules are added to fields, errors appear, a failed submission loses what was typed, or errors show as toasts.

Build: Validate on blur and clear on input once valid. The error sits under its field, tied by `aria-describedby` with `aria-invalid` set, announced in an alert region, and carries a cue besides colour, such as a word or glyph before the message and a heavier border. On submit, focus moves to the first error and typed values stay.

Options:

- **Validate on leaving the field**, clear the error as soon as it is fixed: the default.
- **Live indicator while typing** for rules the person works toward, such as password strength.
- **Error summary at the top** in addition to inline errors, for long forms.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), step 6; [forms-and-controls.md, Validation and submission](../forms-and-controls.md#validation-and-submission); [states.md, Error](../states.md#error).

## Submission and success

Applies when: a submit path is added or changed; a double press sends twice; the form resets silently; a conversion lands nowhere.

Build: A disabled primary action is allowed only with a visible reason next to it; otherwise it stays enabled and validates on submit. While sending, keep the label, add a spinner, set `aria-busy` and ignore repeats. End in a success state in place that says what happened and what comes next, focused or announced in a status region. Typed values survive Back, reload and a failed request.

Options:

- **Enabled submit that surfaces validation** on an incomplete submission, the default.
- **Disabled submit with its visible reason**, when one missing thing blocks it and the reason moves focus to it.
- **Success state in place** for small forms; **a page of its own** after a conversion.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), steps 5 and 7; [states.md, Success](../states.md#success) and [Disabled](../states.md#disabled).

## Consent and honest choices

Applies when: a form carries an agreement, a marketing opt-in, an age or a birth date, a plan or an add-on, or a cancellation; a countdown, a scarcity line or a decline button is added.

Build: Unticked native checkboxes, one per purpose, labelled with the purpose and a link to the notice; accept and decline as sibling buttons of equal weight; a cancel route from the account page; a countdown or stock line read from data; fees, taxes and shipping in the total before the pay button; no preselected add-on, upgrade or donation. Each consent is stored with its time and the text the person saw, and withdrawn as easily as given, as step 2 of the security module's personal-data protocol proves; when that module is not installed, this sentence is the rule.

Options:

- **No alternative.** Each rule of [forms-and-controls.md, Honest choices](../forms-and-controls.md#honest-choices) is a floor.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), step 9; [forms-and-controls.md, Honest choices](../forms-and-controls.md#honest-choices).

## Multi step

Applies when: a form is split into steps, a wizard or a checkout is built, or a request says "break it into steps".

Build: Step names as verbs, the current step and the count visible, Back keeping every value, progress saved when losing it would hurt.

Options:

- **One page** when the steps are not separate decisions.
- **Steps with progress** when they are.

Open: [forms-and-controls.md, Layout and flow](../forms-and-controls.md#layout-and-flow); [ux-laws.md, Time and memory of the flow](../ux-laws.md#time-and-memory-of-the-flow).

## Sign-up and first use

Applies when: registration, sign-in, invitation or onboarding forms are built.

Build: `autocomplete` tokens `username` or `email` and `current-password` or `new-password`, a show-password button with `aria-pressed`, and only the fields the first use needs.

Options:

- **Minimum fields now, the rest later**, with smart defaults.
- **Sign-in that the browser can fill**: autocomplete tokens on the username and password, and a visibility toggle on the password.
- **First use inside the real product** rather than a separate tutorial.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), steps 2 and 8; [states.md, Onboarding](../states.md#onboarding).

## Settings and autosave

Applies when: a settings or preferences page, a profile, or an editor that saves as the person types is built; a request says "save automatically"; a change is lost on leaving.

Build: One saving model per screen, chosen from the options; settings grouped under short headings, the most used first and destructive ones last behind a confirmation; a saving status line near the title in a status region; a failed save keeping the value with its cause and a retry; leaving with unsaved changes asks first. The rules are in [forms-and-controls.md](../forms-and-controls.md#saving-and-settings).

Options:

- **Applied on change** for a toggle or a single choice.
- **Saved on its own** after a pause in typing and on blur, for long text and editors.
- **One Save button per section** for fields validated together or a change that costs money.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), steps 6 and 7; [forms-and-controls.md, Saving and settings](../forms-and-controls.md#saving-and-settings).
