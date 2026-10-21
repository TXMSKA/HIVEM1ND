# Rendering

How often the interface draws itself again, and how much of it each time.

## Wasted renders

Applies when: typing lags, an interaction feels slow, a profiler shows components rendering with nothing changed, or a scroll stops or jumps while data arrives.

Options:

- **Move state down** to the part that uses it, the default.
- **Read only the fields a view shows** from a shared store or context, instead of the whole value.
- **Stable values and callbacks**, where the profile shows that a new one on each render triggers children.
- **Memoize a component or a computation**, only where a measurement shows the gain.

Build: keep each piece of state in the lowest part that needs it, subscribe views to the fields they show, give list items stable keys, and update nodes in place instead of replacing a whole region.

Open: [render-audit](../protocols/render-audit.md), steps 1 to 6; [essentials.md](../essentials.md), Measuring.

## Long lists

Applies when: a list, a table or a feed holds hundreds of rows, or scrolling it drops frames.

Options:

- **Render the visible rows only**, with a fixed or measured row height, the default past a few hundred rows.
- **Paginate or load more**, when the person reads the items in order.
- **Show a count and a search**, when the person looks for one item.

Build: give the scroll container a fixed height, render the visible rows and a margin above and below, keep keys stable, and keep the focused row and the scroll position when rows change.

Open: [render-audit](../protocols/render-audit.md), steps 2, 4 and 5.

## Live updates and timers

Applies when: events from the server, a clock, a timer or polling redraw the interface, or the interface redraws while the person scrolls or types.

Options:

- **Update the item an event names**, the default.
- **Batch events that arrive together** into one frame.
- **Hold a redraw** that would replace a scrolling or focused element until the person stops.

Build: map each event to the views that show what it changed, apply the events of one frame together, never redraw the whole screen for one item, and stop timers and polling while the page is hidden.

Open: [render-audit](../protocols/render-audit.md), steps 3 and 4; [requests-and-caching](../protocols/requests-and-caching.md), step 3.
