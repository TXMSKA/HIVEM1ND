name: requirement-acceptance
purpose: Check delivered work against the requirement IDs its task cites, so a requirement counts as met only when each of its criteria has evidence that the reviewer observed again. The requester or the lead runs it at review; the executor may run steps 1 to 3 before writing its Report.
scope: a task whose `requirements` header lists IDs, when it moves to review, and a stage of a product document before it is accepted
trigger: condition, a task whose requirements header lists IDs moves to review, or a stage is about to be accepted
repeat: once
inputs: the task file with its Report, the product document of the project, the build, screens or files the task delivered, the mind folder
stop: a cited ID does not exist in the product document, which ends the run, and the task goes back to open with that ID named
report: per cited ID its requirement line, the evidence linked in the Report, what the reviewer observed and the verdict; the floors checked; and for a stage the met count against the view's count

The searches are in [essentials.md](../essentials.md#searches), run from the mind folder. The verdicts and the met rule are in [essentials.md](../essentials.md#defaults) and [Met](../essentials.md#met).

## Steps

1. Match the cited IDs to the product document.
   Task: read the `requirements` header of the task and, for each ID, its line in the product document: `git grep --no-index -n -E '^- <ID>( [^:]+)?:' -- user/projects/<project>/product.md`, with an ID known in the document as the positive control.
   Time: 10 minutes.
   Result: one line per cited ID with its requirement line and its stage, and zero IDs missing.

2. Find the evidence for each criterion in the Report.
   Task: for each ID, read the task's Report for an artifact of the kind its criterion names: a capture of the screen state, the figure with its unit and condition, the file and line, or the command with its output.
   Time: 15 minutes.
   Result: per ID the evidence linked, or none, which is a fail. A Report that says done or works without an artifact counts as none.

3. Observe each criterion first-hand.
   Task: on what the task delivered, rerun the command, open the screen or read the file the criterion names, as [delegation](../categories/delegation.md#handing-a-piece-over) requires of a seat.
   Time: 10 minutes per ID; a criterion the tool at hand cannot observe ends as not verifiable, with what a person must check.
   Result: per ID what was observed, and whether it matches the criterion.

4. Check the floors the work touches.
   Task: for each floor line of the product document whose subject the task changed, such as a screen, a data flow or a dependency, observe its condition the same way.
   Time: 15 minutes.
   Result: per floor touched what was observed, or not applicable with the reason. A broken floor is a fail even when every criterion passes.

5. Record the verdict and the count.
   Task: append to the task's Report one line per ID with its verdict, and ask the requester for the status move: to `done` on their acceptance, or back to `open` with the failing IDs. For a stage, list every requirement of the stage with the `done` task that cites it and whether every criterion has evidence, and read the view's count with `node "<mind>/cli/index.mjs" view --json --mind-path "<mind>" --project <project>`, under `products`.
   Time: 10 minutes, the requester's answer not counted.
   Result: one verdict line per ID in the Report, the status move asked for, and for a stage the met count of [Met](../essentials.md#met) beside the view's `met`, with each ID that differs named.
