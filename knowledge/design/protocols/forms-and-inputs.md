name: forms-and-inputs
purpose: Make every field, control and menu cost the fewest presses, say why it is blocked, and fail in place.
scope: forms, fields, selects, menus of options, date and number inputs, search fields and submit flows
trigger: manual, on any change to a form, a field, a select, a menu of options, a date or number input, or a submit path
repeat: once per form, and again whenever a field or a control is added
inputs: the form under work, its validation rules, the rendered page at the narrow and the wide width, a keyboard
stop: a field has no label at all, in which case it gets one before the pass continues
report: the control table, the press count for the slowest field, the transcripts of a failed and a successful submission, and the menus tested near the bottom edge

## Steps

1. Pick each control by the table.
   Task: list every field and control with its option count and its kind of answer, and check each against the control table in [forms-and-controls.md](../forms-and-controls.md). Replace a dropdown of two to four options with radios or a segmented control, and a select for content types with a set of cards.
   Time: 20 minutes.
   Result: the control table recorded, one row per field, with no dropdown holding fewer than five options.

2. Label without helper text.
   Task: give every field a visible label above it, move any format the person must know before typing into the label, and remove the helper sentences under fields and headings, moving each constraint into the error or into a live indicator. Labels are structural words: this pass writes them, from the placeholder or the field's purpose when nothing better exists, and flags them for the copy pass.
   Time: 15 minutes.
   Result: every field has a visible label tied to it, no field is named by its placeholder alone, and no helper sentence remains under a field.

3. Count the presses on the slowest field.
   Task: reach a date thirty years back and the last item of the longest list, by pointer and by keyboard, and count the presses. Make dates typeable in the local order with a year jump, and put a filter field on every list of about ten items or more.
   Time: 20 minutes; a form with no date and no list of ten or more ends this step as not applicable.
   Result: the press count per field recorded, a typed date accepted in the local order, and every list of ten or more rows narrowing as the person types, with a no results state.

4. Keep menus open, anchored and visible.
   Task: open every menu near the bottom edge of the viewport and at the narrow width, and pick several items in each multi-select.
   Time: 15 minutes; a form with no custom menu ends this step as not applicable.
   Result: a screenshot of each menu near the bottom edge, opened upward or fully visible and unclipped by any ancestor; each multi-select stays open, counts the selection and closes with Done.

5. Give every disabled control its reason.
   Task: find every disabled control and write inline what is missing and what unlocks it, with the unblocking action one step away; the reason is a structural word this pass writes and flags for copy. A form that keeps its submit enabled instead lets the incomplete submission run and surfaces the validation, which is the simpler fix when the reasons are several.
   Time: 15 minutes.
   Result: the count of disabled controls without an inline reason is zero, and a transcript shows the reason moving focus to the missing field.

6. Fail in place.
   Task: submit the form empty, then with one invalid field, then valid. Errors sit next to their field and are tied to it, focus moves to the first error, what was typed stays, and the error clears as soon as the value is valid.
   Time: 20 minutes.
   Result: a keyboard transcript of the failed submission showing focus on the first error and no typed value lost, and a screenshot of each error state with its computed contrast.

7. Show the work and the outcome.
   Task: submit valid data over a slowed connection. The button keeps its label, gains a spinner and refuses a second press; the form ends in a success state that says what happened and what comes next. Leave a changed form and confirm it asks first.
   Time: 15 minutes.
   Result: a screenshot of the loading state with the original label, a screenshot of the success state, a count of one request after a double press, and a transcript of the unsaved changes warning.

8. Fit the phone.
   Task: at the narrow width, read the computed input font size, the input type, input mode and autocomplete token of every field, and the size of every control.
   Time: 15 minutes.
   Result: every input at 16 CSS pixels or more, the numeric fields showing a numeric keyboard, known personal fields carrying an autocomplete token, and every control at least 44 by 44 CSS pixels on touch.
