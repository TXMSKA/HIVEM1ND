name: render-audit
purpose: Find the renders that redraw the interface without changing what is on screen, remove them, and prove that each slow interaction does less work.
scope: a rendered interface that redraws, a component tree, a view layer, a long list or a canvas, and any change to how state or live events reach the views
trigger: manual, on a report of slow typing, slow scrolling, a stalled interface or a lost scroll position, and task close for a change to how state reaches the views
repeat: once per surface, and again whenever a slow interaction is reported
inputs: the production build of the application, its framework's profiler or the browser's performance panel, the list of primary interactions from the product document or the brief
stop: the interface cannot be built in production mode, in which case the gap is reported rather than measured on a development build; a fix that changes what the person sees is reverted and reported
report: the interactions measured, the renders and long tasks of each before and after, each wasted render with its cause and its fix, and the guard test

## Steps

1. Record the interactions.
   Task: choose the three to five interactions that are reported as slow or that the product calls primary, such as typing in a field, scrolling a long list, opening an item and receiving a live update. Record each on the production build with the browser's performance panel, CPU throttled 4 times, and note its interaction to next paint and its long tasks, following [essentials.md](../essentials.md), Measuring.
   Time: 30 minutes.
   Result: a table with one row per interaction: its trace file, its interaction to next paint in milliseconds and its count and length of tasks above 50 ms, each the median of three runs.

2. Count the renders.
   Task: count what redraws during each interaction with the framework's profiler (component render counts and the highlight of updates), or, for an interface without one, a counter in each render function and a `MutationObserver` that counts the nodes replaced. Mark each render whose visible output is the same before and after.
   Time: 30 minutes.
   Result: a table of component or view, renders per interaction and wasted renders per interaction, with the total of wasted renders for each interaction.

3. Find the cause of each wasted render.
   Task: for each wasted render, name why it ran: state kept above the part that uses it, a value or a callback created again on every render, a shared context or store read whole while only one field changes, a timer, a clock or a stream event that redraws everything, a whole-screen redraw that replaces nodes instead of updating them, or a list without stable keys.
   Time: 30 minutes.
   Result: every wasted render from step 2 paired with one cause from the list or a cause written out, and none left without one.

4. Remove the work.
   Task: fix each cause at its source: move state down to the part that uses it, read only the fields a view shows, keep values and callbacks stable where the profile shows they trigger renders, batch updates that arrive together into one frame, update nodes in place instead of replacing them, give list items stable keys, render only the visible rows of a long list, and hold a redraw that would replace a scrolling or focused element until the person stops. Memoization is added only where step 2 shows a measured gain.
   Time: 2 hours; a cause that needs a larger change is recorded as a task instead.
   Result: a change list, each change linked to the cause it removes, and the project's tests passing.

5. Measure again.
   Task: record the interactions of step 1 and count the renders of step 2 again, the same way.
   Time: 30 minutes.
   Result: for every interaction, wasted renders and long tasks equal or lower than before, its interaction to next paint within the budget of [essentials.md](../essentials.md), Budgets, or the gap stated, and no interaction slower than before.

6. Guard the result.
   Task: add a test that fails when the main fix regresses: a render count asserted for the key interaction, or a check that an unrelated update leaves a list's or a field's node in place. Prove it by reverting the fix locally and running the test.
   Time: 30 minutes.
   Result: the test passes with the fix, fails with the fix reverted, and its name is in the report.
