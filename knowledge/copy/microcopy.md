# Microcopy

Rules for the strings that sit inside a control or next to one, and for the messages an interface shows about its own state. Each section is one subcategory. A string belongs to exactly one section, and that section decides it; [surface-copy](protocols/surface-copy.md) is the pass that applies them.

## Buttons and controls

- A verb first, and the verb is the thing that will happen: *Save changes*, not *OK* or *Submit*.
- The label matches the heading of the thing it acts on, word for word where possible.
- Sentence case, no ending period (Microsoft style guide, https://learn.microsoft.com/en-us/style-guide/top-10-tips-style-voice).
- Under four words. A label that needs more is a label for a decision the screen has not explained yet (Convention).
- A destructive action names what it destroys: *Delete project*, never *Delete* alone.
- Result to record: count of labels not starting with a verb, and count over four words, each fixed or explained.

## Labels

- A field label names the value, in the words the person uses for it, and stays visible while the field is filled.
- The same object has the same name on every screen and every card. Two names for one metric break scanning (Convention).
- A label that reads clearly needs no sentence beneath it. Where a hint exists, try renaming the label to absorb it before keeping the hint (Practice).
- Result to record: count of objects with more than one name across the diff, which must be zero.

## Placeholders

Placeholder text is not a label. It disappears on input, strains memory, blocks checking answers before submit, is overlooked or read as a default value, and often fails contrast (Measured, https://www.nngroup.com/articles/form-design-placeholders/).

- A visible label outside the field carries the meaning.
- A placeholder, when used at all, shows an example of the format, never an instruction needed later.
- Result to record: count of fields whose only label is a placeholder, which must be zero.

## Helper text

- None by default, under a field or under a heading (Practice: helper lines under clearly labelled fields were cut as noise, and the same applied to subheadings under headings).
- A constraint that matters before typing, such as a password rule, lives in an indicator that reacts as the person types. A constraint that matters after is stated by the error.
- Conflict, resolved: the placeholder study above asks for hints that stay visible. A live indicator is visible and persistent, so it satisfies that finding without a static sentence printed before anything went wrong.
- Result to record: count of static helper lines kept, each with the constraint that could not be shown live.

## Tooltips

- Supplementary only. Nothing needed to complete the task lives only in a tooltip (Convention).
- One fragment or one sentence. Never a repeat of the visible label.
- No instructions pinned to abstract places, such as a hint telling the person to click a decorative element (Practice).
- Result to record: count of tooltips carrying information found nowhere else on the screen.

## Navigation and menus

- Places are nouns, actions are verbs. A menu mixing the two is two menus.
- An item names the object it opens, in the same words as the heading of the page it opens.
- Order by frequency of use or by the order of the work, never alphabetically by accident.
- Result to record: count of items whose destination heading differs from the item text.

## Errors

Guidelines from https://www.nngroup.com/articles/error-message-guidelines/.

- Placed next to the thing that caused it. On a form, focus moves to the first failing field.
- Says precisely what happened. A generic message is a failure even when polite.
- Says what to do next. Identifying the problem is half the message.
- No blame words. *Invalid* and *illegal* describe the person, not the input.
- No jokes, no raw jargon, no bare error code as the whole message.
- The input is preserved, so the person edits what they typed.
- Not shown before the field is finished, except where the field is known to be error-prone.
- Result to record: for each error string, placement, cause, next step and input preserved, each ticked or exempted in writing.

## Blocked controls

- A disabled control says inline what is missing and what unlocks it, and the unlocking action is one step away: a disabled save becomes *Complete the email to continue*, with focus on that field (Convention).
- Applies to every critical control, not only submit.
- Result to record: count of disabled controls without a reason, which must be zero.

## Warnings and confirmations

Guidelines from https://www.nngroup.com/articles/confirmation-dialog/.

- Only for serious consequences that cannot be undone. A confirmation on a routine action trains people to click through all of them.
- The title and body name the action and the object: *Delete the project Q3 plan and its 14 files?*, not *Are you sure?*.
- Buttons say what they do, *Delete project* and *Keep project*, never *Yes* and *No*, and the destructive one is not the default.
- For the most dangerous operations, a non-standard confirmation such as typing the object's name.
- Result to record: count of confirmations with generic button labels or a generic question, which must be zero.

## Success

- After any submission, a real confirmation states what happened and, when there is one, what happens next: *Message sent. A reply usually arrives within two days.* A silent reset is a failure.
- One line. No celebration beyond it (Convention).
- Result to record: count of submissions without a success state.

## Empty states

Three kinds, and the kind decides the content (Carbon empty states pattern, https://v10.carbondesignsystem.com/patterns/empty-states-pattern/):

1. First use: nothing has been created yet. This is the onboarding moment.
2. No results: a search or filter excluded everything. The current query stays visible.
3. Error or no permission: data exists but cannot be shown. The wording never implies the person simply has not started.

- The title names the real object: *No projects yet*, not *No data*.
- One or two sentences say why it is empty and what the first step is.
- One primary action, matched to the kind: create, clear the filter, retry or request access. Not two.
- Nothing about parts of the product that are not this one.
- Result to record: count of empty states without a next action, and count of the three kinds sharing one string, both zero.

## Loading and progress

- Name what is loading: *Loading invoices*, not *Loading*.
- A long operation shows how far along it is and what remains, in steps or a count.
- Result to record: count of loading strings without an object.

## Onboarding steps

- Each step states the outcome the person gets, then the action, in that order.
- One action per step. A step with two actions is two steps.
- Skippable, and saying so is part of the copy.
- No welcome paragraph that teaches nothing. The first screen either does something or is removed.
- Result to record: steps counted, actions per step counted, and the word ratio against the previous version.
