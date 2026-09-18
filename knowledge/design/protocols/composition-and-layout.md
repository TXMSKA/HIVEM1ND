name: composition-and-layout
purpose: Give each reading moment one dominant object, on a shared grid, with space that means something.
scope: page structure, grids, sections, spacing, cards and containers
trigger: manual, on any change to page structure, grid, sections, spacing, cards or containers
repeat: once per surface, and again after any section is added or removed
inputs: the surface under work, the grid definition, the rendered page at every breakpoint
stop: the change is confined to one component that owns no layout of its own
report: the dominant object per section, the column counts, the count of card levels, and the horizontal overflow measurement per breakpoint

## Steps

1. Lead with the argument.
   Task: decide what the first viewport has to carry: the claim, the evidence, the comparison or the tool itself. Compose it so that a reader who saw only that viewport remembers the central relationship rather than the title. A masthead followed by orientation copy is a delay, not an opening.
   Time: 20 minutes.
   Result: a screenshot of the first viewport at the widest and the narrowest supported width, with the object it is built around named in one line.

2. Choose the geometry before the components.
   Task: map the material to a visual variable rather than to a component. Magnitude and rank become position or length on one scale; change over time becomes horizontal order with aligned positions; composition becomes proportion; a threshold becomes distance from a boundary; a process becomes connection and sequence; qualitative alternatives become aligned rows or deliberately contrasted columns.
   Time: 20 minutes.
   Result: one line per section naming the variable and the reason, and a chart only where a relationship is faster to see than to read. Values alone never earn a chart.

3. Put everything on the grid.
   Task: place every object on the shared grid, normally twelve columns on desktop, six on tablet and four on mobile, with reading prose in six or seven desktop columns and evidence free to take the full width. Align each object to a shared edge, baseline or grid line. A surface built as one contained column records the column width and the edges its objects share instead.
   Time: 30 minutes at most.
   Result: the objects off the grid or off a shared edge are listed, with the count of those on it, and no wrapped heading or phrase reads across a gutter into the next column.

4. Make the space mean something.
   Task: put every gap on one of the three bands in [tokens.md](../tokens.md), with the density rules there: the tighter value first, no content band stretched to the viewport height, no padding stacked on a child margin. Then find the large empty rectangles: an underfilled split, an orphaned third item, a sparse final row, a grid with empty cells. Reflow or rebalance each one, or add content; never pad around it. A grid of a known count takes column counts that divide it at each breakpoint, or lets a lead item span; auto-fit columns are for open-ended collections, as in [containers](../categories/containers.md), Cards.
   Time: 20 minutes.
   Result: the distinct gap values resolve to three bands, no section has a minimum height tied to the viewport without a pinned sequence that needs it, and every remaining empty area is recorded with the focal object it amplifies.

5. Give every container a job.
   Task: list the cards, panels and dividers. A container stays when it groups one concept into a unit, marks selection, interaction or a warning, or holds a target: a card, a shadow or a divider grouping related content is a valid choice, per uniform connectedness in [ux-laws.md](../ux-laws.md). A container that holds another container of the same kind is flattened into spacing, and one that groups nothing is removed.
   Time: 20 minutes.
   Result: one line per container naming the group or the state it marks, zero cards nested inside cards, and zero containers recorded as grouping nothing.

6. Cut the repetition.
   Task: list what each section asks and answers. Combine sections that answer the same question, and keep one evidence home per claim. Repetition is rhythm only between true peers; between unequal findings it is template noise.
   Time: 20 minutes.
   Result: one line per section naming a question no earlier section answered, and the count of sections removed or merged.

7. Measure the overflow.
   Task: read the document scroll width against its client width at every supported breakpoint, and give grid and flex children a zero minimum width so content reflows before it shrinks.
   Time: 10 minutes.
   Result: scroll width equals client width at every breakpoint, and no scrollbar appears that the layout did not ask for.
