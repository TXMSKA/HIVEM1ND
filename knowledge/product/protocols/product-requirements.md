name: product-requirements
purpose: Write or update the product document of a product or a family from the records, so that what it is, for whom and what it must do at each stage lives in one file that tasks and reviews cite by ID. The seat of the project runs it; the coordinator runs it for a family product document or a project with no seat.
scope: the product document of one product or one family of products, a first product document included, and any change to what a product is for or must do
trigger: condition, a product has no product document, the check reports one missing or older than its brief, or a product decision changes one
repeat: once
inputs: the brief of the project, the scope file in `user/overseer/` and the brainstorm files of the topic, the boards named in the `board` header, the Architecture sections of the project's tasks, the annexes the product document lists, the voice specification named in the `voice` header, the family product document for a product
stop: the user does not approve a part, which ends the run with `updated` as it was, per [essentials.md](../essentials.md#approval)
report: the path of the product document and its `updated` date, the sources read and the ones missing, the requirements per stage with the counts of step 3, the out-of-scope lines, the floor lines, the open questions, the annexes, the screens with no requirement, the brief Facts shrunk to one line, the Relay notes sent, and the approvals with their dates

The searches of the steps are in [essentials.md](../essentials.md#searches), run from the mind folder, each beside its positive control.

## Steps

1. Gather the sources.
   Task: read `user/projects/<project>/product.md` first when it exists, with the annexes it lists. Then read the brief whole, noting every Fact that carries a `(product: <section>)` pointer, the scope file in `user/overseer/` and the brainstorm files of the topic, the boards (the path in `board`, else `docs/flows/boards/index.json` of the repository), the Architecture sections of the project's tasks, and the voice specification (the path in `voice`). For a product, read the family product document named in `family` as well.
   Time: 20 minutes; a source not read in time is recorded as unread and the run continues.
   Result: a list of the sources, each with its path and date or marked missing, the `updated` date of the existing product document, and the date of the newest Fact with a pointer.

2. State the problem and the audience.
   Task: write Problem and audience and Value from the sources: who the product is for, what they cannot do or do badly today, and what changes for them. A point the sources leave open is settled with the user as [essentials.md](../essentials.md#approval) sets out. A family product document is drafted part by part this way and states the audience its products share.
   Time: 30 minutes, the user's answers not counted.
   Result: both sections are in the file, and each sentence is paired in the report with the line of a source from step 1 that holds it. The count of sentences without a source is zero.

3. Write the requirements per stage.
   Task: under Requirements, write the groups `### Alpha`, `### Beta` and `### Release`, one line per requirement in the form of [requirements](../categories/requirements.md#requirement-lines), taking each from agreed text, from Facts with a pointer and from the results the tasks' Requests state. The `CODE` is the product's existing code, or for a first product document a short uppercase one the user chooses once. Numbers continue the highest in the stage and are never reused. Run the three counts and the repeated-ID search of [essentials.md](../essentials.md#searches) on the product document.
   Time: 40 minutes, the user's answers not counted.
   Result: the three counts equal, no repeated ID, every criterion naming a criterion kind of [essentials.md](../essentials.md#defaults), and zero criteria made only of a quality word. The number of requirements per stage is recorded.

4. Write the out-of-scope list.
   Task: under Out of scope, write one line for each thing the sources exclude on purpose, as [scope](../categories/scope.md#out-of-scope) sets out: the options the scope and brainstorm records rejected, the Facts that rule something out and the requests the user declined, with the reason when a source gives one.
   Time: 10 minutes.
   Result: every line is paired in the report with its source, the count of lines without one is zero, and no line names a behaviour that a requirement asks for.

5. Write the remaining sections.
   Task: write Plans as names pointing to the price table of the family product document; Floors as one line each for local first, privacy, weak devices and platforms, each stating a condition of a criterion kind, in the form of [essentials.md](../essentials.md#defaults); Depends on as the lines `- Products:` and `- Shared contracts:`; Open questions for everything the sources leave undecided, a floor no source states included; and Annexes as one line each, `- <name>: <path>`, the path being `annexes/<name>.md` beside the product document or a repository path, or `none`. A family product document also writes Rules, Product map, Stages and Design direction as the path of the design document, and holds the price table once in Plans with currency and period on every price. Run the floor count of [essentials.md](../essentials.md#searches) on the product document, and the second count on each annex.
   Time: 30 minutes, the user's answers not counted.
   Result: every section the format asks for exists in its order and none is empty, `none` standing where nothing applies. The floor count is 4 and zero floor lines are made only of a quality word. A product document holds no price, and a family product document holds each price once. Each annex line names a file that exists, and the count on each annex finds no requirement line.

6. Cross-check against the brief, the boards and the voice.
   Task: for every Fact with a pointer, open the section it names and confirm it holds what the Fact says, then shorten the Fact to one line with its pointer. List the screens of the board in `board` and map each to a requirement ID; a screen with no requirement becomes an open question and is never turned into a requirement. Read the voice specification and compare the product document's terms for the product's own things with its word table.
   Time: 20 minutes; a board or a voice specification that does not exist ends that part as not applicable, recorded as missing.
   Result: no pointer Fact names a missing section or one that lacks its content, and none stays longer than one line once the product document holds it. No screen is left without a requirement or an open question. No word the voice specification refuses appears in the product document.

7. Set `updated` and hand it over.
   Task: set `updated` to today's date and `stage` from the records, asking the user only when they do not state it, and hand the document over as [essentials.md](../essentials.md#approval) sets out: the user's yes for a family product document or one the coordinator writes, the `User decisions` note to the coordinator for a seat's. When the change touches a shared contract, send the Relay note described under Depends on in [files.md](../../../files.md#product-projectsprojectproductmd), one to each product listed in Depends on. Run `node "<mind>/cli/index.mjs" check --mind-path "<mind>"`.
   Time: 15 minutes, the user's approval not counted.
   Result: `updated` is today's date and not older than the newest pointer Fact, the check prints no product document line for the project, one note is recorded per product listed or the report says none was due, and the report records the user's yes with its date, or the `User decisions` note sent to the coordinator.
