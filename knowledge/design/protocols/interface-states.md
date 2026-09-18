name: interface-states
purpose: Design and prove every state a surface can reach, not only the populated one.
scope: controls, lists, tables and anything that loads, fails, is empty or succeeds
trigger: manual, on any control, list or table, and on anything that loads, fails, can be empty or confirms an action
repeat: once per component, and again whenever a data path is added
inputs: the component under work, its data contract, the rendered page
stop: a state has no design at all, in which case it is designed before the pass continues rather than left to the framework
report: the state inventory with one screenshot each, the contrast per state, and the list of dead ends found

## Steps

1. Inventory the states.
   Task: list every state the component can reach: rest, hover, active, keyboard focus, selected, disabled, loading, error, empty, success, and partial or sparse where the data allows it. A state that the code can reach and the list does not name is the one that ships broken.
   Time: 15 minutes.
   Result: the written inventory, with the condition that produces each state next to it.

2. Capture each one.
   Task: drive the component into every state in the inventory and capture it, in each theme that ships when colour distinguishes the state.
   Time: 30 minutes; a state that cannot be reached from the interface is forced, and the record says how. In a mock or a demo build, a query parameter such as `?state=loading`, `empty`, `error` or `slow` read by the data layer gives every state a stable address; in a real build, the component's prop, a class on the root, or a delayed or failed response from the browser's request tools does the same without shipping the switch.
   Result: one capture per state, named after the component and the state, and the computed contrast of the text in each.

3. Give every empty and error state a way forward.
   Task: write each empty state by its kind in [states.md](../states.md), with a title naming the real object, a visual, the reason and one action. Write each error as what failed and how to recover, in the interface's own voice. These are structural words: this pass writes them and flags them for the copy pass. When the product has no action that could resolve an empty state, the reason says so and the record names the missing action.
   Time: 20 minutes.
   Result: the copy for every empty and error state recorded, each naming one concrete next action, and no screen in the inventory that ends without a next step.

4. Show work and outcome honestly.
   Task: give every activation feedback within about 400 milliseconds, every wait a skeleton in the shape of the final content, every disabled control an inline reason, and every completed action a success state rather than a silent reset.
   Time: 20 minutes.
   Result: the loading capture with the skeleton occupying the final box; the shift measurement in [evidence.md](../evidence.md) for each loading surface, with the top of the content at the same position before, during and after loading, and no element inserted above it; zero disabled controls without an inline reason; and a success capture for every action that submits or saves.

5. Announce what appears on its own.
   Task: put a polite live region on every toast, inline validation, loading change and success message that appears without the person moving focus.
   Time: 15 minutes.
   Result: the live region present on each, confirmed in the accessibility tree.

6. Protect the destructive paths.
   Task: give every destructive action an undo window when recovery is safe, or a confirmation that names the object and the consequence when it is not, and warn before navigation discards unsaved changes.
   Time: 15 minutes.
   Result: one transcript per destructive action showing the undo or the confirmation, and one showing the unsaved changes warning.

7. Run the content extremes.
   Task: render every text slot with an empty string, a one-word value, an average value and a value far longer than the design assumed, and render lists at zero, one, a typical count and a large count. Add a failed network response and a missing permission.
   Time: 20 minutes.
   Result: a screenshot per extreme with no overflow, no broken layout and no clipped word, and nothing shifting when the data lands.
