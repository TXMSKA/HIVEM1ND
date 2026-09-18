# Actions

What a person presses to make something happen: buttons, links, action menus, floating and sticky actions, copy and share.

## Buttons

Applies when: a button is added or restyled; several calls to action compete; a request says "make the button pop", "the button feels dead"; a button lacks a press, loading or disabled state.

Options:

- **One primary, one or two secondary, the rest quiet**: the hierarchy of every screen. The primary is the one visually distinct action.
- **Press feedback** by a slight shrink while held, starting on pointer down; **hover** gated to hover-capable pointers.
- **Loading** keeps the label and adds a spinner; **disabled** carries an inline reason.
- **Destructive** labelled by its verb and object, with an undo or a confirmation; **hold to confirm** for an action a single click could fire by accident.
- **A signature treatment** for the main call to action when the direction gives it one; it is not flattened back into a plain rectangle.

Open: [interface-states](../protocols/interface-states.md); [colour-and-theming](../protocols/colour-and-theming.md), step 5; [animation.md](../animation.md), Recipes; [ux-laws.md](../ux-laws.md), Von Restorff and Fitts.

## Links

Applies when: links are added or restyled in text or navigation; link text reads "click here"; a navigation control is built as a button.

Options:

- **Underlined links in running text**, distinguishable without colour alone.
- **Quiet links in navigation and lists**, identified by position and a hover or focus reaction.
- **An anchor, not a button, for anything that navigates**, so opening in a new tab and the middle click still work.

Open: [accessibility](../protocols/accessibility.md), step 1; [colour-and-theming](../protocols/colour-and-theming.md), step 6.

## Action menus

Applies when: a row or a card has several actions; an overflow menu, a context menu or a command palette is added; actions are hidden and hard to find.

Options:

- **Visible actions** for the one or two used most, **an overflow menu** for the rest.
- **A context menu** on desktop as a shortcut, never as the only way.
- **A command palette** for power users of a tool, opened by a shortcut shown in the interface, with no animation.
- **Bulk actions** that appear when several rows are selected.

Open: [overlays.md](../overlays.md), Popover and menu; [animation.md](../animation.md), Gates.

## Floating and sticky actions

Applies when: a call to action should stay reachable while scrolling, on a lead page or on phones; a floating button covers content.

Options:

- **A floating contact or action** on a lead-generation page.
- **A sticky bar at the bottom on phones**, within the thumb's reach.
- **One floating action per screen at most**, for the single primary action, never a stack of them.

Open: [site-polish.md](../site-polish.md); [responsive-behaviour](../protocols/responsive-behaviour.md), steps 5 and 7.

## Copy and share

Applies when: a snippet, a code, a link or an identifier is meant to be copied or shared.

Options:

- **A copy button** next to the value with a short confirmation, announced to assistive technology.
- **A native share sheet** on phones where the platform offers one.

Open: [site-polish.md](../site-polish.md), Build first; [interface-states](../protocols/interface-states.md), step 5.
