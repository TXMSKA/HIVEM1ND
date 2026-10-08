# Requirements

The product document of a product or of a family of products: what it is, for whom, and what it must do at each stage, in one file that tasks and reviews cite by ID. Defaults for the whole category: the seat of the project writes and keeps its product document, the coordinator reviews it and the user approves, one requirement per line, one acceptance criterion per requirement, and nothing that is status or order of work. Its protocol is in the [routing table](../INDEX.md#routing).

## Product document

Applies when: a product has no `product.md`, a request asks for the product document, the requirements or the scope of a product, or the check reports a product document missing or older than its brief.

Options:

- **Drafted from the records and approved whole**, the default, when the brief, the scope files and the boards already hold the answers.
- **Drafted part by part with the user through `/brainstorm`**, when the records leave the audience, the stages or the limits open.

Build: the header filled, with `none` where a field has nothing to point at. Problem and audience and Value from the brief and the scope records. Requirements as lines with an ID and a criterion, grouped Alpha, Beta, Release. Out of scope from what the records excluded. Plans as names, pointing to the family price table. One line each for the four floors. Depends on as two lines, Products and Shared contracts. Open questions for what no record settles. Annexes as one line each, `- <name>: <path>`, or `none`: the how of the product, such as its architecture, goes there and cites requirement IDs without restating them. Every brief Fact the product document now holds shrinks to one line with its pointer.

Open: [product-requirements](../protocols/product-requirements.md), steps 1 to 7; [files.md](../../../files.md#product-projectsprojectproductmd), the sections of a product document.

## Family product document

Applies when: several products share a price table, rules or shared contracts and the family has no product document, or a rule changes for every product at once.

Options:

- **Part by part with the user**, the default, written by the coordinator, which owns the family product document: Problem and audience, Value, Rules, Product map, Stages, Plans and Floors, one part shown and approved before the next.
- **From the records**, when the products already agree on their rules and prices and the product document only gathers them.

Build: the price table once, in Plans, one row per plan with every price written with currency and period. Rules that hold for every product, never restated in a product document. A Product map of one line per product with its name, its code and what it is for, the stage staying in each product's own product document. Stages stating what alpha, beta and release mean in the family. Design direction as the path of the design document, never a copy. The family product document is written before the product documents it governs, so that they point to it instead of repeating it.

Open: [product-requirements](../protocols/product-requirements.md), steps 1 to 5 for each part; [files.md](../../../files.md#product-projectsprojectproductmd), the family product document.

## Requirement lines

Applies when: a requirement is added, split, reworded or moved to another stage, or a criterion reads as a quality word such as fast, simple or reliable.

Options:

- **A screen state**, for what a person sees: the list shows a paid mark on that order only.
- **A figure with its unit and the condition it is measured under**, for what is counted or timed: the first screen opens in under two seconds on a mid-range phone over a mobile connection.
- **A file or the output of a command**, for what a tool produces.

Build: `- <CODE>-<A|B|R>-<NN>: <what the product does>. Accepted when: <criterion>.` One behaviour per line, so a line joining two with "and" becomes two IDs. The number continues the stage and is never reused, and a requirement that moves stage takes a new ID. A criterion a reviewer cannot observe is rewritten until it can be, or the requirement goes to Open questions.

Open: [product-requirements](../protocols/product-requirements.md), step 3.

## Keeping it current

Applies when: a product decision is taken in any chat, a brief Fact changes what the product is or must do, a task needs an ID that does not exist yet, a change to a product document touches a shared contract, or the check reports a product document missing, behind its brief or over 20 KB.

Options:

- **The seat edits the product document in the turn the decision is taken**, the default, and sends the coordinator its `User decisions` note so that the change is reviewed.
- **The coordinator writes the Fact with its pointer and a Relay note to the seat**, when the decision is taken with the coordinator, and the product document stays behind the Fact until the seat edits it. A project with no seat has the coordinator edit the product document itself.

Build: the edit and the new `updated` date in the same turn, the brief Fact left as one line with its pointer, such as `(product: Requirements/Beta)`. When the change touches a shared contract, one Relay note to each product listed in Depends on. A product document over 20 KB is usually carrying status, history or the how: status moves to the survey, history to the log and the how to an annex or to the Architecture section of a task.

Open: [product-requirements](../protocols/product-requirements.md), steps 6 and 7; [files.md](../../../files.md#product-projectsprojectproductmd), Depends on.
