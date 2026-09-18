# Evidence

A protocol step is finished when it has produced an artifact. Four kinds count, and nothing else does.

## Computed number

A value read out of the running page or the stylesheet, recorded with the element it belongs to.

- **Contrast ratio.** Measured on the rendered pair, foreground against the surface actually behind it, in each theme. The browser accessibility inspector reports it; a script that reads both computed colours and returns the ratio does the same job and can walk every text node at once. Record the number to one decimal, the two colours and the element. A ratio that changes with state is measured in each state.
- **Measure.** The characters per line of a text block, computed from the block width and the width of a representative character run rather than counted by eye. Record the number per breakpoint.
- **Duration.** The computed transition or animation duration in milliseconds, per property, read from the computed style.
- **Size.** The bounding box of a target in CSS pixels, read from the element rather than from the source, so that padding and pseudo-element hit areas are included.
- **Overflow.** The scroll width of the document against its client width at a named viewport width. Equal means no horizontal scroll.

## Screenshot of a named state

A screenshot is evidence only when the state it shows is named in the record: the element, the state and the viewport. A page screenshot proves the page rendered, not that the state exists. Both themes when the change touches colour, both motion preferences when it touches motion.

## Search that returns no hits

The negative checks in [defaults.md](defaults.md) and in the protocols are run as searches over the component tree, and the finished result is zero hits. When hits remain, each one carries a file and line reference and the sentence in the brief that earns it. A search nobody ran is not a clean search.

## Keyboard walk transcript

Focus the document from the address bar and move forward through the whole surface with the tab key, then back. Record one line per stop, in order: the element, whether the focus ring was visible, whether anything covered it, and what the enter or space key did. A transcript is complete when it reaches the end of the page and returns, and when every interactive element in the source appears in it. Any element that appears in the source and not in the transcript is a finding, and so is any stop that the transcript reaches but the pointer path does not.

## Ranking findings

Findings are ranked so that a long list stays usable. The test for the boundary between the first two: a person would contact support about it.

| Rank | Meaning | When it is fixed |
| --- | --- | --- |
| P0 | Blocks the task. The interface cannot be completed as built. | Immediately, before anything else in the pass |
| P1 | Significant difficulty, or a WCAG AA failure | Before the surface ships |
| P2 | An annoyance with a workaround | In the next pass |
| P3 | Polish, no practical impact | When there is time |

Every finding carries the location, the impact in one line, and the fix. A finding without a fix is an observation, and a list of observations is not a report.

## Recording

The evidence belongs to the pass that produced it, so it goes where that pass is reported: the numbers inline in the report, the screenshots named after the state. Nothing is reported as verified without the artifact that verified it, and a check that could not be run is reported as not run rather than left out.
