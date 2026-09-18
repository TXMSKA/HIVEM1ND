# Agent text

Rules for text whose reader is an agent: prompts and briefs, rules and instruction files, knowledge topics, and documents another person authors with an agent's help. Each section is one subcategory.

All of it is written in English, whatever language the conversation around it uses, because agents follow English instructions more reliably and a mixed file is read inconsistently (Practice).

## Prompts and briefs

- Scope first: what the receiving agent owns, what it must not touch, and what done means as a checkable result.
- Maximum context, zero overlap: everything the agent needs to act without the conversation it was not part of, and nothing another agent is doing at the same time.
- Plain text. A fenced block inside a prompt that is itself fenced never uses the same fence, because nested triple backticks break the outer block on screen (Practice).
- No persona preamble and no praise of the agent. The first line is the task.
- Result to record: the owned paths, the forbidden paths and the done condition, each present or added.

## Rules and instruction files

- One rule per line, in the imperative, with its reason on the same line or the next.
- Plain and readable by a person. No encoded, compressed or hidden content, and nothing addressed to the agent that the person is told not to see (Practice: an encoded rules file carrying such a header tripped an injection detector although its content was benign).
- A rule that restates another rule is deleted, not reworded.
- Result to record: count of rules without a reason, and count of duplicate rules removed.

## Knowledge topics

- Impersonal, plain, no second person, no absolute paths, nothing personal or tied to one organisation.
- Every figure carries its source, and every chosen value is marked as a convention (see the marks in [options.md](options.md)).
- A topic states rules and their reasons. It does not narrate how it was written.
- Result to record: count of figures without a source, and count of chosen values without a mark.

## Documents another person authors

For a design document, a brief or a specification that belongs to someone else, where the agent types but does not author.

- Only the author's text, the author's notes and the labels the author gave. No copywriting added between them (Practice: a first pass was rejected for density and for labels the agent had invented).
- No meta-labels such as *Key insight*, *Note*, *In summary* or *TL;DR*.
- An open question is asked, not answered in the document. A proposed section is marked as proposed and never quoted later as agreed.
- Result to record: count of sentences not traceable to the author, which must be zero, and the count of open questions asked.
