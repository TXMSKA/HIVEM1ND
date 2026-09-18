name: hierarchy-and-type
purpose: Make one reading order obvious and keep every size, weight and measure on a named role.
trigger: manual, on any change to headings, body copy, type scale, weights, measure or numerals
repeat: once per surface, and again whenever a role is added
inputs: the type roles in the token file, the stylesheet, the rendered page at every breakpoint
stop: the surface has no text of its own and only composes typed components
report: the role table, the measure per breakpoint, the largest computed font size, the lowest letter spacing, and the count of sizes written outside the roles

## Steps

1. Assign roles.
   Task: map every piece of text on the surface to one of the named roles in [tokens.md](../tokens.md). Text that fits no role either takes the closest one or justifies a new role that more than one place will use.
   Time: 20 minutes.
   Result: a table of text blocks against roles with no empty cells, and the count of distinct font sizes in the stylesheet equal to the count of roles.

2. Remove the free sizes.
   Task: search the component tree for font size, font weight and line height written outside the role definitions, and move each hit onto a role.
   Time: 15 minutes.
   Result: the search returns zero hits.

3. Measure the measure.
   Task: compute the characters per line of every body block at each breakpoint, by the method in [evidence.md](../evidence.md).
   Time: 15 minutes; when a block cannot be narrowed without breaking the grid, record the number and raise it as a finding.
   Result: every body block computes between 65 and 75 characters, and none exceeds 80. Serif body text may sit at the top of the range and carries more line height than the sans equivalent.

4. Cap the display and the tracking.
   Task: read the computed font size of the largest text and the computed letter spacing of every element.
   Time: 10 minutes.
   Result: the largest computed font size is at or below 6rem, and no computed letter spacing is below -0.04em. Negative tracking below that floor collides glyphs at the sizes where it is usually applied.

5. Set the numerals.
   Task: find every place where numbers are compared down a column or across peers, and set tabular numerals on it.
   Time: 10 minutes.
   Result: a screenshot of one such column showing the digits aligned, and a search showing the tabular numeral declaration on every compared set.

6. Build the rhythm from relationships.
   Task: read the computed margins around headings, paragraphs, groups and section turns, and move each gap onto one of the three bands in [tokens.md](../tokens.md). Give every gap one owner.
   Time: 20 minutes.
   Result: the computed space above each heading is larger than the space below it, the gaps resolve to three bands rather than one repeated value, and no child adds a margin on top of a container gap.

7. Check the outline and the breaks.
   Task: read the document outline, then read the real copy at every breakpoint for stranded words in large headings and for overflow.
   Time: 15 minutes.
   Result: the outline holds exactly one level-one heading and skips no level, and no heading or lede ends on a single stranded word at any breakpoint. Stranded words are fixed by rewriting the copy or changing the measure, never by shrinking one element.
