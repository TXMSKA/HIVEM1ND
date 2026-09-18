# Feedback

What the interface says about its own state: something failed, something is blocked, something is about to happen, something worked, or there is nothing to show. Defaults for the whole category: Plain tone, one sentence, result first, dash policy none, no jokes (see [options.md](../options.md)). Every subcategory runs [surface-copy](../protocols/surface-copy.md).

## Errors

Applies when: "improve this error message", a validation message, a failed request, a toast or banner reporting a failure, an error page, a string containing *invalid*, *error* or *failed*.

Options: second person when the fix is the reader's action, impersonal when the system failed. One sentence for the cause and one for the next step. The error code, when shown, follows the sentence and never replaces it.

Open: [microcopy.md, Errors](../microcopy.md#errors).

## Blocked controls

Applies when: a control is disabled, greyed out or hidden until a condition is met, or "why can't the form be submitted".

Options: one sentence naming what is missing and what unlocks it, as an instruction.

Open: [microcopy.md, Blocked controls](../microcopy.md#blocked-controls).

## Warnings and confirmations

Applies when: a confirmation dialog, "are you sure", a delete, reset, overwrite, publish or payment that cannot be undone, a warning banner before a risky action.

Options: a title naming the action and the object, one sentence of consequence, two buttons that say what they do. Safety wording already in place is filler only (see [boundaries.md](../boundaries.md)).

Open: [microcopy.md, Warnings and confirmations](../microcopy.md#warnings-and-confirmations), and [rewrite-boundary](../protocols/rewrite-boundary.md) when the text carries safety or consent language.

## Success

Applies when: a form submits, a save completes, a payment goes through, a toast reports that something worked.

Options: one line, what happened and what happens next. No exclamation beyond one, no celebration.

Open: [microcopy.md, Success](../microcopy.md#success).

## Empty states

Applies when: "No data available", an empty list, table, inbox or search result, a screen with nothing to show, a permission screen.

Options: a title naming the object, one or two sentences, one action. Warm tone is allowed for the first-use kind and never for the error kind.

Open: [microcopy.md, Empty states](../microcopy.md#empty-states). The first-use kind also belongs to [onboarding.md](onboarding.md).

## Loading and progress

Applies when: a spinner, skeleton or progress bar gets a label, a long operation reports its progress, "Loading..." appears in a diff.

Options: a fragment naming the object; steps or a count for long work.

Open: [microcopy.md, Loading and progress](../microcopy.md#loading-and-progress).
