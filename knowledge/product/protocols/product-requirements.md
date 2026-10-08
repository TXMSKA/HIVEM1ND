name: product-requirements
purpose: Write or update the PRD of a product or a family from the records, so that what it is, for whom and what it must do at each stage lives in one file that tasks and reviews cite by ID.
scope: the PRD of one product or one family of products, a first PRD included, and any change to what a product is for or must do
trigger: manual, run by the coordinator with the user, when a product has no PRD, when the check reports a PRD older than its brief, or when a product decision changes one
repeat: once per PRD, and again whenever the check reports it behind its brief or a product decision changes it
inputs: the brief of the project, the scope file in `user/manager/` and the brainstorm files of the topic, the boards named in the `board` header, the Architecture sections of the project's tasks, the voice specification named in the `voice` header, the family PRD for a product
stop: the user does not approve a part, in which case the run stops there, reports it and leaves `updated` as it was; a source that does not exist is recorded as missing and never filled in with a guess; a step with nothing to act on ends as not applicable with its reason
report: the path of the PRD and its `updated` date, the sources read and the ones missing, the requirements per stage, the out-of-scope lines, the open questions, the screens with no requirement, the brief Facts shrunk to one line, the Relay notes sent, and what the user approved

## Steps

1. Gather the sources.
   Task: read `user/projects/<project>/prd.md` first when it exists. Then read the brief whole, noting every Fact that carries a `(prd: <section>)` pointer, the scope file in `user/manager/` and the brainstorm files of the topic, the boards (the path in `board`, else `docs/flows/boards/index.json` of the repository), the Architecture sections of the project's tasks, and the voice specification (the path in `voice`). For a product, read the family PRD named in `family` as well.
   Time: 20 minutes; a source not read in time is recorded as unread and the run continues.
   Result: a list of the sources, each with its path and date or marked missing, the `updated` date of the existing PRD, and the date of the newest Fact with a pointer.

2. State the problem and the audience.
   Task: write Problem and audience and Value from the sources: who the product is for, what they cannot do or do badly today, and what changes for them. A point the sources leave open is settled with the user through `/brainstorm`: the substance is agreed first, the text is shown, and it is written into the PRD only after a yes on the text. A family PRD is drafted part by part this way and states the audience its products share.
   Time: 30 minutes, the user's answers not counted.
   Result: both sections are in the file, and each sentence is paired in the report with the line of a source from step 1 that holds it. The count of sentences without a source is zero.

3. Write the requirements per stage.
   Task: under Requirements, write the groups `### Alpha`, `### Beta` and `### Release`, one line per requirement in the form `- <CODE>-<A|B|R>-<NN>: <what the product does>. Accepted when: <criterion>.`, taking each from agreed text, from Facts with a pointer and from the results the tasks' Requests state. The `CODE` is the product's existing code, or for a first PRD a short uppercase one the user chooses once. Numbers continue the highest in the stage and are never reused. List the IDs with `rg -o "^- [A-Z][A-Z0-9]*-[ABR]-[0-9]{2}:" user/projects/<project>/prd.md` and the criteria with `rg -c "Accepted when:" user/projects/<project>/prd.md`.
   Time: 40 minutes, the user's answers not counted.
   Result: every ID matches the form and appears once, the two counts are equal, every criterion names a screen state, a figure with its unit, a file or the output of a command, and the count of criteria made only of a quality word such as fast, simple or reliable is zero. The number of requirements per stage is recorded.

4. Write the out-of-scope list.
   Task: under Out of scope, write one line for each thing the sources exclude on purpose: the options the scope and brainstorm records rejected, the Facts that rule something out and the requests the user declined, with the reason when a source gives one. Nothing is added that no source excludes.
   Time: 10 minutes.
   Result: every line is paired in the report with its source, and the count of lines without one is zero. No line names a behaviour that a requirement asks for.

5. Write the remaining sections.
   Task: write Plans as names pointing to the price table of the family PRD, Floors as one line each for local first, privacy, weak devices and platforms, Depends on as the lines `- Products:` and `- Shared contracts:`, and Open questions for everything the sources leave undecided, a floor no source states included. A family PRD also writes Rules, Product map, Stages and Design direction as the path of the design document, and holds the price table once in Plans with currency and period on every price.
   Time: 30 minutes, the user's answers not counted.
   Result: every section the format asks for exists in its order and none is empty, `none` standing where nothing applies. A product PRD holds no price, and a family PRD holds each price once.

6. Cross-check against the brief, the boards and the voice.
   Task: for every Fact with a pointer, open the section it names and confirm it holds what the Fact says, then shorten the Fact to one line with its pointer. List the screens of the board in `board` and map each to a requirement ID; a screen with no requirement becomes an Open question and is never turned into a requirement. Read the voice specification and compare the PRD's terms for the product's own things with its word table.
   Time: 20 minutes; a board or a voice specification that does not exist ends that part as not applicable, recorded as missing.
   Result: no pointer Fact names a missing section or one that lacks its content, and none stays longer than one line once the PRD holds it. No screen is left without a requirement or an open question. No word the voice specification refuses appears in the PRD.

7. Set `updated` and hand it over.
   Task: set `updated` to today's date and confirm `stage` with the user. Show the PRD whole, or each part of a family PRD as it was written, and wait for the user's approval. When the change touches a shared contract, send the Relay note described under Depends on in `files.md`, one to each product listed in Depends on. Run `node "<mind>/cli/index.mjs" check --mind-path "<mind>"`.
   Time: 15 minutes, the user's approval not counted.
   Result: `updated` is today's date and not older than the newest pointer Fact, the check prints no PRD line for the project, one note is recorded per product listed or the report says none was due, and the user's approval is recorded in the report with its date.
