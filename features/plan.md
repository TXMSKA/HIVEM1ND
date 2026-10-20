---
name: plan
description: Splits a request into ordered task files for the owning units and sends each unit a message without implementing it.
category: planning
---

# /plan

Mind: {{mind}}
Argument: <text>

Start: Locate in `rules.md` of the mind above.

## Steps

1. Read the routes, and the briefs and product documents of the projects the request touches.
2. Split the request into pieces that can fail on their own, in dependency order, each with the unit that owns it.
3. Read the `INDEX.md` of every installed knowledge module, in `knowledge/` and `user/knowledge/` of the mind, and for each piece open only the categories it touches.
   - The `Build:` lines of those subcategories go into that piece's request as cited recipes, each naming the file it came from; the floors in each pack's `essentials.md` are the requirements.
   - The request lists only the protocols the piece uses: of those the categories name, the global ones in `user/protocols/` and the local ones of its project in `user/projects/<project>/protocols/`, a protocol is kept only when something the piece builds falls inside its `scope`, and is named next to that item.
4. Create each piece with `/task` for its owner, in dependency order, so that every `depends` names ids already written. `/task` writes the id, `from`, `to` and the Relay message, and routes the task to the lead when the owner has one.
   - `requirements` cites the IDs of the product document the piece delivers, when the project has one.
   - `work` names its kind of work from the `delegation` category, so that the executor takes that row of `models.md`.
5. Implement nothing.

## End

- Stops when every piece is a task.
- Reports the task ids in order, each with its owner and its `depends`.
