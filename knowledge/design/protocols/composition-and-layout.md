name: composition-and-layout
purpose: Give each reading moment one dominant object, on a shared grid, with space that means something.
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
   Task: place every object on the shared grid, normally twelve columns on desktop, six on tablet and four on mobile, with reading prose in six or seven desktop columns and evidence free to take the full width. Align each object to a shared edge, baseline or grid line.
   Time: 30 minutes.
   Result: the column span of every object is recorded, no object sits off the grid, and no wrapped heading or phrase reads across a gutter into the next column.

4. Make the space mean something.
   Task: put every gap on one of the three bands in [tokens.md](../tokens.md). Then find the large empty rectangles: an underfilled split, an orphaned third item, a sparse final row. Reflow or rebalance each one.
   Time: 20 minutes.
   Result: the distinct gap values resolve to three bands, and every remaining empty area is recorded with the focal object it amplifies.

5. Remove the containers that carry nothing.
   Task: count the card levels and the borders. A page is one continuous canvas until a surface communicates selection, interaction, warning or a grouping that spacing cannot express. Replace decorative containers with spacing, alignment and a change in density.
   Time: 20 minutes.
   Result: the count of nested card levels is zero, the count of top-level cards is recorded, and no border remains whose removal would not change the meaning.

6. Cut the repetition.
   Task: list what each section asks and answers. Combine sections that answer the same question, and keep one evidence home per claim. Repetition is rhythm only between true peers; between unequal findings it is template noise.
   Time: 20 minutes.
   Result: one line per section naming a question no earlier section answered, and the count of sections removed or merged.

7. Measure the overflow.
   Task: read the document scroll width against its client width at every supported breakpoint, and give grid and flex children a zero minimum width so content reflows before it shrinks.
   Time: 10 minutes.
   Result: scroll width equals client width at every breakpoint, and no scrollbar appears that the layout did not ask for.
