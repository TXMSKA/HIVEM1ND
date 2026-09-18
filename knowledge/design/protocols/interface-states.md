name: interface-states
purpose: Design and prove every state a surface can reach, not only the populated one.
trigger: manual, on any control, form, list or table, and on anything that loads, fails or can be empty
repeat: once per component, and again whenever a data path is added
inputs: the component under work, its data contract, the rendered page
stop: a state has no design at all, in which case it is designed before the pass continues rather than left to the framework
report: the state inventory with one screenshot each, the contrast per state, and the list of dead ends found

## Steps

1. Inventory the states.
   Task: list every state the component can reach: rest, hover, active, keyboard focus, disabled, loading, error, empty, and partial or sparse where the data allows it. A state that the code can reach and the list does not name is the one that ships broken.
   Time: 15 minutes.
   Result: the written inventory, with the condition that produces each state next to it.

2. Capture each one.
   Task: drive the component into every state in the inventory and capture it, in both themes when colour distinguishes the state.
   Time: 30 minutes; a state that cannot be reached from the interface is reached by forcing the prop or the class, and the record says which.
   Result: one screenshot per state, named after the component and the state, and the computed contrast of the text in each.

3. Make the empty state an invitation.
   Task: write the empty state as a direction rather than a mood: what goes here and the action that puts it there. Write the error state as the problem and the recovery, in the interface's own voice, never vague and never apologising.
   Time: 20 minutes.
   Result: the copy for both states recorded, each naming one concrete next action, and no screen in the inventory that ends without a next step.

4. Keep the control usable while it works.
   Task: keep a submit enabled until the request starts, then disable it and show a spinner while keeping the original label. Accept free text and validate after, never blocking typing, and allow an incomplete submission so the validation can surface.
   Time: 20 minutes.
   Result: the loading screenshot shows the original label beside the spinner, and a transcript of one submission with an empty required field showing the validation appearing rather than the submission being blocked.

5. Put the errors where the fields are.
   Task: render each error inline next to its field, move focus to the first error on submit, and announce transient messages through a polite live region.
   Time: 20 minutes.
   Result: a keyboard transcript of a failed submission showing focus landing on the first error, and the live region present on every toast and inline validation.

6. Protect the destructive paths.
   Task: give every destructive action either a confirmation or an undo window, and warn before navigation discards unsaved changes.
   Time: 15 minutes.
   Result: one transcript per destructive action showing the confirmation or the undo, and one showing the unsaved changes warning.

7. Run the content extremes.
   Task: render every text slot with an empty string, a one-word value, an average value and a value far longer than the design assumed, and render lists at zero, one, a typical count and a large count.
   Time: 20 minutes.
   Result: a screenshot per extreme with no overflow, no broken layout and no clipped word, and skeletons that occupy the same box as the content they stand in for, so nothing shifts when the data lands.
