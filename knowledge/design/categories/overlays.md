# Overlays

Surfaces above the page: modals, drawers and sheets, popovers and dropdowns, toasts, tooltips, banners. The first decision is whether the overlay should exist; [overlays.md](../overlays.md), Choosing the kind, settles which kind interrupts least.

## Modal and confirmation

Applies when: a dialog is added; a destructive action asks for confirmation; focus escapes a dialog or is lost on close; a request says "put it in a popup".

Options:

- **A modal** for a blocking decision or a destructive confirmation, naming the object and the consequence.
- **An undo** instead of a confirmation when recovery is safe.
- **Inline or a drawer** when the task needs neither interruption nor protected focus.
- **A full-height sheet** in place of a long modal on phones.

Build: A native `dialog` opened with `showModal()` and labelled by its title; focus on the first field, or on the safe action of a confirmation; Escape closes it natively, and a backdrop click closes it only through `closedby="any"` or a click handler on the dialog itself, since `showModal()` does not provide it; focus returns to the opener, or to the next logical control when the opener is gone, as in [overlays.md](../overlays.md), Modal.

Open: [interface-states](../protocols/interface-states.md), step 6; [accessibility](../protocols/accessibility.md), step 2; [overlays.md](../overlays.md), Modal; [animation.md](../animation.md), Recipes.

## Drawer and sheet

Applies when: a side panel slides in; contact, filters or detail open from several places; a sheet is dragged on a phone.

Options:

- **A drawer from the side** for a secondary task reached from several entry points.
- **A bottom sheet** on phones in place of a dropdown or a modal.
- **A draggable sheet** that follows the finger and dismisses on a flick.

Build: A panel at its edge, translated by 100 percent of its size when closed, entering on the sheet curve in up to 500 milliseconds, with modal focus handling when it blocks the page.

Open: [overlays.md](../overlays.md), Drawer and sheet; [motion](../protocols/motion.md), step 4.

## Popover and dropdown

Applies when: a panel opens from a control; a dropdown is clipped or detached from its trigger; a menu appears from the centre of the screen.

Options:

- **A popover anchored to its trigger**, growing from it, flipping to the side with room.
- **A portal** when an ancestor clips overflow.
- **A sheet** on phones when the content is more than a few items.

Build: A panel anchored to its trigger and mounted outside any clipping ancestor, through the `popover` attribute or a portal, flipping to the side with room; Escape closes it and returns focus.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), step 4; [overlays.md](../overlays.md), Popover and menu.

## Toast

Applies when: an action confirms itself; a notification appears; toasts stack; an error is shown as a toast.

Options:

- **A toast** for a result that needs no answer, with an undo when the action is reversible.
- **Inline at the field** for form errors.
- **A banner in the page** for a persistent condition, such as being offline.

Build: A status region in the page from the first load, toasts appended inside it at one bottom corner, 6 seconds each, paused on hover, focus and a hidden tab, a close button, and an undo when the action can be reversed.

Open: [overlays.md](../overlays.md), Toast; [interface-states](../protocols/interface-states.md), step 5.

## Tooltip

Applies when: an icon-only control needs its name; a tooltip holds instructions; tooltips open slowly across a toolbar.

Options:

- **A tooltip that names** a control, on hover and on focus.
- **Text on the page** when the content is needed to proceed.
- **A first-use hint** that points at a new feature once and never returns after dismissal.

Build: Shown on hover and on focus of its trigger after a short delay, linked by `aria-describedby`, holding no control, hidden by Escape, with the same words reachable another way on touch.

Open: [overlays.md](../overlays.md), Tooltip; [animation.md](../animation.md), Recipes; [states.md](../states.md), Onboarding.

## Banners and consent

Applies when: a cookie or consent banner, an announcement bar or a system notice is added.

Options:

- **No banner** when there is nothing to consent to.
- **A consent banner** that preselects the most private choice and never covers the primary action.
- **An announcement bar** that can be dismissed and stays dismissed.

Build: Only when there is something to consent to or announce: a region at the page edge that never covers the primary action, the most private choice preselected, and the dismissal remembered.

Open: [overlays.md](../overlays.md), Banners and consent; [site-polish.md](../site-polish.md).
