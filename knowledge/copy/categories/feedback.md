# Feedback

What the interface says about its own state: something failed, something is blocked, something is about to happen or can be undone, something worked, there is nothing to show, or the product needs a permission. Defaults for the whole category: Plain tone, one sentence, result first, dash policy none, no jokes (see [options.md](../options.md)). Its protocols are in the [routing table](../INDEX.md#routing).

## Errors

Applies when: "improve this error message", a validation message, a failed request, a toast or banner reporting a failure, an error page, a string containing *invalid*, *error* or *failed*.

Build: the row of its cause in the [table of causes](../microcopy.md#table-of-causes). A field the reader fixes gets one instruction that carries the cause: *Enter a due date*. A system failure gets the cause, the next step and, where true, that the input was kept: *The invoice was not saved. Try again; your entries are still here.* Sign-in gets one message for either credential: *The email or password is incorrect.*

Options: second person when the fix is the reader's action, impersonal when the system failed; an error code, when shown, follows the sentence and never replaces it.

Open: [microcopy.md, Errors](../microcopy.md#errors).

## Blocked controls

Applies when: a control is disabled, greyed out or hidden until a condition is met, or "why can't the form be submitted".

Build: *{What is missing} to {what it unlocks}*, placed at the control: *Add a client email to send this invoice*.

Options: one sentence as an instruction; with several reasons, the control stays enabled and the errors say them on submit.

Open: [microcopy.md, Blocked controls](../microcopy.md#blocked-controls).

## Warnings and confirmations

Applies when: a confirmation dialog, "are you sure", a delete, reset, overwrite, publish or payment that cannot be undone, a warning banner before a risky action.

Build: title as a question naming action and object: *Delete invoice 2041?*; one sentence of consequence: *It cannot be restored.*; buttons *Delete invoice* and *Keep invoice*, the safe one the default.

Options: impersonal; safety wording already in place is filler only (see [boundaries.md](../boundaries.md#filler-only)).

Open: [microcopy.md, Warnings and confirmations](../microcopy.md#warnings-and-confirmations).

## Success

Applies when: a form submits, a save completes, a payment goes through, a toast reports that something worked, a surface shows that it saved on its own.

Build: *{Object} {past participle}.* then what happens next when something does: *Invoice sent. The client gets a reminder if it is unpaid on the due date.* A surface that saves on its own shows *Saving*, then *Saved*.

Options: one line; no exclamation beyond one, no celebration.

Open: [microcopy.md, Success](../microcopy.md#success).

## Undo

Applies when: a reversible action such as a delete, an archive or a move confirms itself with an undo; a confirmation guards an action that could be undone.

Build: the result with its object and one *Undo* button: *Invoice deleted.* / *Undo*; after the undo, *Invoice restored.*

Options: past tense, no person; a count for several items: *3 invoices deleted.*

Open: [microcopy.md, Undo](../microcopy.md#undo).

## Empty states

Applies when: "No data available", an empty list, table, inbox or search result, a screen with nothing to show, a permission screen.

Build: the row of its kind in [microcopy.md](../microcopy.md#empty-states): title *No {objects} yet* for first use, *No {objects} match {query}* for no results, the cause for a failure; one sentence of why and the first step; one action: *Create invoice*, *Clear filters*, *Try again*.

Options: Warm tone for the first-use kind, never for the failure kinds.

Open: [microcopy.md, Empty states](../microcopy.md#empty-states); the first-use kind also belongs to [onboarding.md](onboarding.md#first-use-empty-state).

## Loading and progress

Applies when: a spinner, skeleton or progress bar gets a label, a long operation reports its progress, "Loading..." appears in a diff.

Build: *Loading {objects}*; for long work *{Step} {current} of {total}* or a count: *Importing 40 of 120 invoices*.

Options: a fragment naming the object; steps or a count for long work.

Open: [microcopy.md, Loading and progress](../microcopy.md#loading-and-progress).

## Permission requests

Applies when: the product asks for the camera, the microphone, the location, notifications or contacts; a browser prompt appears with no explanation; a denied permission leaves a screen silent.

Build: a title with what is asked and what the person gets: *Allow notifications to hear when a client pays*; buttons *Allow notifications* and *Not now*; after a denial, *Notifications are off. Turn them on in the browser settings to hear when a client pays.*

Options: second person, one sentence; a request already in place is filler only for a rewrite.

Open: [microcopy.md, Permission requests](../microcopy.md#permission-requests).
