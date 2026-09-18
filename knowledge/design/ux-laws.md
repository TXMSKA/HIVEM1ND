# UX laws

Twenty heuristics from usability and human-computer interaction research, each with the design rule it implies. They are a critique instrument: read a screen against them and name the concrete violation and its fix, rather than quoting the law. A finding written from this file carries the element, the law it breaks, and the change that fixes it.

## Decision cost and attention

- **Hick's law.** More visible options means more time to decide. Reduce what is on screen at once, group the rest, and reveal detail progressively.
- **Miller's law.** Working memory is small. Break information into chunks of three to five items and avoid walls of options.
- **Von Restorff effect.** The element that differs is the one noticed and remembered. Give a screen exactly one visually distinct primary action; three competing calls to action cancel each other out.
- **Parkinson's law.** Work expands to fill the time available. Cut steps and fields to the minimum, and timebox long multi-step flows.
- **Occam's razor.** Between two designs that do the same job, take the simpler one. Cut ornamental features.

## Pointing and reach

- **Fitts's law.** A target is easier to hit the larger and the closer it is. Make primary buttons large, and never put a critical action in a small corner.
- **Minimize target distance.** Less travel is less friction. Put frequent actions near the context they act on, and within reach of the thumb on a handheld screen.

## Grouping and form

- **Law of proximity.** Elements placed close together are read as related. Keep a label with its field, and separate sections with real space.
- **Law of similarity.** Elements that look alike are read as the same kind of thing. Same appearance means same function, so never give two different actions the same look.
- **Uniform connectedness.** A shared border, background or connecting line groups more strongly than proximity alone. Where a group has to read as one unit, use a card or a divider rather than relying on whitespace by itself.
- **Law of Pragnanz.** Simple, ordered shapes are perceived faster. Simplify layouts, cut visual noise, keep hierarchy explicit.

## Expectation and convention

- **Jakob's law.** People expect a product to behave like the products they already use. Follow the familiar patterns of the domain and do not reinvent navigation without a reason.
- **Postel's law.** Be strict in what is emitted and tolerant in what is accepted. Take imperfect input, then validate and normalize it internally, while keeping output unambiguous.
- **Tesler's law.** Complexity is conserved: it moves between the system and the person, it does not disappear. Absorb it in intelligent defaults rather than pushing it onto the reader.

## Time and memory of the flow

- **Doherty threshold.** A response under roughly 400 milliseconds feels continuous. Give immediate feedback on every activation, and show a skeleton or progress indicator when the work takes longer.
- **Serial position effect.** The first and last items in a sequence are recalled best. Put what matters at the start and at the end of a list or a flow.
- **Peak-end rule.** An experience is judged by its most intense moment and by how it ended. Design the hardest step and the closing state, success or failure, with the most care.
- **Zeigarnik effect.** Unfinished work stays on the mind. Show incomplete progress, through steps or checklists, to pull toward completion.
- **Goal-gradient effect.** Effort increases as the end comes into view. Make remaining distance visible, and give early progress for free where it is honest to do so.
- **Aesthetic-usability effect.** A design that looks better is perceived as more usable, which buys tolerance for real friction. Spend polish on the states that matter most, but never trade clarity for appearance.

## Closing checklist

- [ ] No more options at once than a person can weigh, against Hick and Miller.
- [ ] Primary action large, reachable and close to its context, against Fitts and target distance.
- [ ] Familiar patterns where the domain has them, against Jakob.
- [ ] Grouping legible, against proximity, similarity and connectedness.
- [ ] Feedback under 400 milliseconds or an explicit loading state, against Doherty.
- [ ] One visually dominant primary action, against Von Restorff.
- [ ] Strong opening and strong close on the flow, against serial position and peak-end.
- [ ] Complexity absorbed by the system, against Tesler.
- [ ] Input accepted tolerantly and normalized, against Postel.
- [ ] The simplest design that does the job, against Occam.
