# Scope

What a product, a stage or a piece of work covers and what it leaves out, decided before the requirements are written and kept as decisions change. Defaults for the whole category: a scope file or brainstorm file holds open questions only while a topic is defined, agreed text leaves it in the same turn for the product document, and a behaviour enters the product only as a requirement the user decided. The one home of each fact is in [files.md](../../../files.md#product-projectsprojectproductmd).

## Defining a topic

Applies when: a new product, feature or stage is being defined with the user, or a request asks what a product should cover.

Build: one open question per line in the scope file or the brainstorm file; each answer the user agrees moves in the same turn into the section of the product document it belongs to, or, for a project with a seat, into a brief Fact with its pointer and the Relay note to the seat; a file left with no question is deleted.

Options:

- **Part by part through `/brainstorm`**, the default, one decision approved at a time.
- **From the records**, when the brief and the boards already settle the topic and only need gathering.

Open: [product-requirements](../protocols/product-requirements.md), steps 1 and 2.

## Stage cut

Applies when: requirements are assigned to alpha, beta or release, a stage is about to be accepted, or a requirement moves stage.

Build: each requirement sits in exactly one stage, a stage holds what must be observable for that stage to be accepted, and a requirement that moves stage takes a new ID. A family's Stages section says what each stage means for every product in it.

Options:

- **Smallest observable product first**, the default: alpha holds the one flow that proves the value, and the rest waits.
- **By dependency**, when later work builds on earlier pieces: a stage holds what the next one needs.

Open: [product-requirements](../protocols/product-requirements.md), step 3; [requirement-acceptance](../protocols/requirement-acceptance.md), step 5, for a stage's count.

## Out of scope

Applies when: an option is rejected, a request is declined, or a requirement is removed.

Build: one line per excluded thing, with its source and the reason when the source gives one, and never a behaviour a requirement asks for. Something deferred to a later stage is a requirement of that stage or an open question, never an out-of-scope line.

Options:

- **Excluded for good**, written in Out of scope.
- **Deferred**, written as a requirement of the later stage or as an open question.

Open: [product-requirements](../protocols/product-requirements.md), step 4.

## A request outside the requirements

Applies when: a task, a request or a review asks for behaviour no requirement holds, or a task's `requirements` header names an ID that does not exist.

Build: the request is mapped to an existing ID, or recorded as an open question until the user decides; a new requirement takes a new ID only on the user's decision, and the task cites it after.

Options:

- **Mapped to an existing requirement**, when one already covers the behaviour.
- **A new requirement on the user's decision**, written by the seat in the turn it is decided.
- **Declined**, written in Out of scope with its source.

Open: [product-requirements](../protocols/product-requirements.md), steps 3 and 7; [requirement-acceptance](../protocols/requirement-acceptance.md), step 1.
