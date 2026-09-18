# Forms

Fields combined into a task: sign-up, checkout, contact, settings, editors. The controls themselves are in [inputs-and-controls.md](inputs-and-controls.md).

## Layout

Applies when: a form is created or rearranged; fields sit in several columns; a request says "the form is long" or "the form looks messy".

Options:

- **One column**, the default for a form filled top to bottom.
- **Paired fields on one row** only when they are read as one thing, such as a first and a last name.
- **Grouped sections with short headings** for long forms, with more space between groups than inside them.
- **Inline editing** instead of a form in a modal when the person is changing one value in place.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), step 1; [forms-and-controls.md](../forms-and-controls.md), Layout and flow; [ux-laws.md](../ux-laws.md), proximity.

## Validation and errors

Applies when: rules are added to fields, errors appear, a failed submission loses what was typed, or errors show as toasts.

Options:

- **Validate on leaving the field**, clear the error as soon as it is fixed: the default.
- **Live indicator while typing** for rules the person works toward, such as password strength.
- **Error summary at the top** in addition to inline errors, for long forms.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), step 6; [forms-and-controls.md](../forms-and-controls.md), Validation and submission; [states.md](../states.md), Error.

## Submission and success

Applies when: a submit path is added or changed; a double press sends twice; the form resets silently; a conversion lands nowhere.

Options:

- **Enabled submit that surfaces validation** on an incomplete submission.
- **Disabled submit with an inline reason** that names what is missing and moves focus to it; valid, never without the reason.
- **Success state in place** for small forms; **a page of its own** after a conversion.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), steps 5 and 7; [states.md](../states.md), Success, Disabled.

## Multi step

Applies when: a form is split into steps, a wizard or a checkout is built, or a request says "break it into steps".

Options:

- **One page** when the steps are not separate decisions.
- **Steps with progress** when they are: the current step and the count shown, a back route that keeps what was entered, verbs as step names, saved progress when losing it would hurt.

Open: [forms-and-controls.md](../forms-and-controls.md), Layout and flow; [ux-laws.md](../ux-laws.md), goal-gradient and Zeigarnik.

## Sign-up and first use

Applies when: registration, sign-in, invitation or onboarding forms are built.

Options:

- **Minimum fields now, the rest later**, with smart defaults.
- **Sign-in that the browser can fill**: autocomplete tokens on the username and password, and a visibility toggle on the password.
- **First use inside the real product** rather than a separate tutorial.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md); [states.md](../states.md), Onboarding.
