# Evidence

A protocol step is finished when it has produced an artifact. Five kinds count, and nothing else does.

## Computed number

A value read out of the running page or the stylesheet, recorded with the element it belongs to.

- **Contrast ratio.** Measured on the rendered pair, foreground against the surface actually behind it, in each theme. The browser accessibility inspector reports it; a script that reads both computed colours and returns the ratio does the same job and can walk every text node at once, blending any translucent background onto the surface beneath it. Record the number to one decimal, the two colours and the element. A ratio that changes with state is measured in each state; a hover or active pair that is hard to drive in the browser is computed from the token pair its rule uses, and recorded as computed. On a gradient or an image, the ratio is taken against the worst stop or the worst sampled pixel behind the text.
- **Measure.** The characters per line of a text block, computed from the block width and the width of a representative character run rather than counted by eye. Record the number per breakpoint.
- **Duration.** The computed transition or animation duration in milliseconds, per property, read from the computed style.
- **Size.** The bounding box of a target in CSS pixels, read from the element rather than from the source, so that padding and pseudo-element hit areas are included.
- **Overflow.** The scroll width of the document against its client width at a named viewport width. Equal means no horizontal scroll.
- **Shift.** The top of the first content element under a loading indicator, read with its bounding box before loading, during loading and after the data lands. The same value in all three means nothing moved; an element inserted above the content is a finding.

## Screenshot of a named state

A screenshot is evidence only when the state it shows is named in the record: the element, the state and the viewport. A page screenshot proves the page rendered, not that the state exists. Each theme that ships when the change touches colour, both motion preferences when it touches motion.

A capture is valid only when entrance animations had settled, it starts from the top of the page, and it was looked at afterwards to confirm it shows what its name says. A capture taken and not looked at proves nothing. A tool that returns captures inline rather than as files is fine: the record names each one by element, state, theme and width.

## Search that returns no hits

The negative checks in [defaults.md](defaults.md) and in the protocols are run as searches over the component tree, and the finished result is zero hits. When hits remain, each one carries a file and line reference and the sentence in the brief that earns it. A search nobody ran is not a clean search.

## Keyboard walk transcript

Focus the document from the address bar and move forward through the whole surface with the tab key, then back. Record one line per stop, in order: the element, whether the focus ring was visible, whether anything covered it, and what the enter or space key did. When the tool cannot deliver those keys, the line says so, as in Tool limits below. A transcript is complete when it reaches the end of the page and returns, and when every interactive element in the source appears in it. Any element that appears in the source and not in the transcript is a finding, and so is any stop that the transcript reaches but the pointer path does not.

## Written critique

The judgment in [critique.md](critique.md), written against named captures before any number was read, one line per question with the element it concerns. It is the evidence that the surface is good, as opposed to usable: passing numbers on an ugly page are not a pass.

## Ranking findings

Findings are ranked so that a long list stays usable. The test for the boundary between the first two: a person would contact support about it.

| Rank | Meaning | When it is fixed |
| --- | --- | --- |
| P0 | Blocks the task. The interface cannot be completed as built, including a floor failure that stops a whole group of people, such as keyboard or phone users, from finishing the primary job | Immediately, before anything else in the pass |
| P1 | Significant difficulty, or any other WCAG AA failure | Before the surface ships |
| P2 | An annoyance with a workaround | In the next pass |
| P3 | Polish, no practical impact | When there is time |

Every finding carries the location, the impact in one line, and the fix. A finding without a fix is an observation, and a list of observations is not a report.

## Tool limits

Some evidence cannot be produced by the tool at hand. The check is then recorded as not verifiable with this tool, together with the static proof that was possible and what a person must check by hand, and the pass continues. A check skipped silently is still a failure; a check recorded this way is not.

| Evidence | Common limit | Record instead | A person checks |
| --- | --- | --- | --- |
| Enter or Space activating a control | the browser pane sends key events that do not activate native buttons | activation by pointer or by `element.click()` on the focused element, marked programmatic; a native `button` or `a` with `href` activates from the keyboard by definition | Enter and Space on each custom control |
| Escape closing a dialog | the key event does not reach the dialog's cancel | the Escape handler read in source, or the dialog closed by its close method | Escape on each overlay |
| Reduced motion | the tool emulates colour scheme only | the `prefers-reduced-motion` block read in the stylesheet, listing what it removes | the state change with the system setting on |
| Live region announcement | no screen reader in the tool | the role or `aria-live` read from the accessibility tree before the message arrives | the announcement with a screen reader |
| Real touch, real ultra-wide display | emulation only | the emulated width, marked emulated | the surface on the device |
| A second reviewer for fresh eyes | a single agent with no second session | the critique written from captures before any number | the verdict in [critique.md](critique.md), Fresh eyes |
| A live change of the system theme | the emulated change fires no media event | a reload under each scheme | switching the system theme with the page open |
| States behind a sign-in | the pass may not or cannot authenticate | the states forced through the DOM or a mocked response, marked forced | each signed-in state in a real session |
| A capture confirmed by eye | the pane scales a wide capture below legibility and offers no zoomed crop | captures at the narrow and the middle width, confirmed; the wide one recorded with its computed numbers | the wide capture at full size |

## Portable commands

Every search in this module is written as a regular expression that `rg` runs unchanged in PowerShell and in a Unix shell. Whether `rg` is available is checked with `rg --version`, not `which`, since some shells provide it as a function that `which` does not report. Scope each search to the files it concerns rather than the whole tree.

| Shell | Form |
| --- | --- |
| Any, with `rg` | `rg -n "<pattern>" -g "*.css" <folder>` |
| PowerShell without `rg` | `Get-ChildItem <folder> -Recurse -Include *.css \| Select-String -Pattern '<pattern>'` |
| Unix shell without `rg` | `grep -rnE --include='*.css' '<pattern>' <folder>`; where `\s` is not understood, write `[[:space:]]` |

Measurements in the running page are read with a script in the browser console or the browser tool, which is the same on every system: `getComputedStyle(el)` for colours, sizes and durations, `el.getBoundingClientRect()` for targets and shift, and `document.documentElement.scrollWidth` against `clientWidth` for overflow.

## Proportion

A pass scales to the surface. The Time on each step is a ceiling. A step whose subject the surface does not have, such as dates on a form with none or a grid on a single column, ends as not applicable with its reason in one line. On a surface of one or two screens, a step that asks for a table of every object records the objects that fail and the count of those that pass.

## Recording

The evidence belongs to the pass that produced it, so it goes where that pass is reported: in the task report when a task is open, otherwise in the reply that closes the pass. The numbers go inline and the captures are named after the state. Nothing is reported as verified without the artifact that verified it, and a check that could not be run is reported as not run, or as not verifiable with the tool at hand, rather than left out.
