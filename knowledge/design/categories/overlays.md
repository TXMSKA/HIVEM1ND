# Overlays

Surfaces above the page: modals, drawers and sheets, popovers and dropdowns, toasts, tooltips, banners. The first decision is whether the overlay should exist; [overlays.md](../overlays.md), Choosing the kind, settles which kind interrupts least.

## Modal and confirmation

Applies when: a dialog is added; a destructive action asks for confirmation; focus escapes a dialog or is lost on close; a request says "put it in a popup".

Options:

- **A modal** for a blocking decision or a destructive confirmation, naming the object and the consequence.
- **An undo** instead of a confirmation when recovery is safe.
- **Inline or a drawer** when the task needs neither interruption nor protected focus.
- **A full-height sheet** in place of a long modal on phones.

Open: [interface-states](../protocols/interface-states.md), step 6; [accessibility](../protocols/accessibility.md), step 2; [overlays.md](../overlays.md), Modal; [animation.md](../animation.md), Recipes.

## Drawer and sheet

Applies when: a side panel slides in; contact, filters or detail open from several places; a sheet is dragged on a phone.

Options:

- **A drawer from the side** for a secondary task reached from several entry points.
- **A bottom sheet** on phones in place of a dropdown or a modal.
- **A draggable sheet** that follows the finger and dismisses on a flick.

Open: [overlays.md](../overlays.md), Drawer and sheet; [motion](../protocols/motion.md), step 4.

## Popover and dropdown

Applies when: a panel opens from a control; a dropdown is clipped or detached from its trigger; a menu appears from the centre of the screen.

Options:

- **A popover anchored to its trigger**, growing from it, flipping to the side with room.
- **A portal** when an ancestor clips overflow.
- **A sheet** on phones when the content is more than a few items.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), step 4; [overlays.md](../overlays.md), Popover and menu.

## Toast

Applies when: an action confirms itself; a notification appears; toasts stack; an error is shown as a toast.

Options:

- **A toast** for a result that needs no answer, with an undo when the action is reversible.
- **Inline at the field** for form errors.
- **A banner in the page** for a persistent condition, such as being offline.

Open: [overlays.md](../overlays.md), Toast; [interface-states](../protocols/interface-states.md), step 5.

## Tooltip

Applies when: an icon-only control needs its name; a tooltip holds instructions; tooltips open slowly across a toolbar.

Options:

- **A tooltip that names** a control, on hover and on focus.
- **Text on the page** when the content is needed to proceed.
- **A first-use hint** that points at a new feature once and never returns after dismissal.

Open: [overlays.md](../overlays.md), Tooltip; [animation.md](../animation.md), Recipes; [states.md](../states.md), Onboarding.

## Banners and consent

Applies when: a cookie or consent banner, an announcement bar or a system notice is added.

Options:

- **No banner** when there is nothing to consent to.
- **A consent banner** that preselects the most private choice and never covers the primary action.
- **An announcement bar** that can be dismissed and stays dismissed.

Open: [overlays.md](../overlays.md), Banners and consent; [site-polish.md](../site-polish.md).
