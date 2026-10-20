# Overlays

Surfaces above the page: modals, drawers and sheets, popovers and dropdowns, toasts, tooltips, banners and permission requests. The first decision is whether the overlay should exist; [overlays.md](../overlays.md), Choosing the kind, settles which kind interrupts least.

## Modal and confirmation

Applies when: a dialog is added; a destructive action asks for confirmation; focus escapes a dialog or is lost on close; a request says "put it in a popup".

Build: A native `dialog` opened with `showModal()` and labelled by its title; focus on the first field, or on the safe action of a confirmation; Escape closes it natively, and a backdrop click closes it, unless closing would lose entered data, through `closedby="any"` or a click handler on the dialog itself, since `showModal()` does not provide it; focus returns to the opener, or to the next logical control when the opener is gone, as in [overlays.md](../overlays.md), Modal.

Options:

- **A modal** for a blocking decision or a destructive confirmation, naming the object and the consequence.
- **An undo** instead of a confirmation when recovery is safe.
- **Inline or a drawer** when the task needs neither interruption nor protected focus.
- **A full-height sheet** in place of a long modal on phones.

Open: [interface-states](../protocols/interface-states.md), step 6; [accessibility](../protocols/accessibility.md), step 2; [overlays.md, Modal](../overlays.md#modal); [animation.md, Recipes](../animation.md#recipes).

## Drawer and sheet

Applies when: a side panel slides in; contact, filters or detail open from several places; a sheet is dragged on a phone.

Build: A panel at its edge, translated by 100 percent of its size when closed, entering on the sheet curve at the drawer duration in [animation.md](../animation.md#numbers), with modal focus handling when it blocks the page.

Options:

- **A drawer from the side** for a secondary task reached from several entry points.
- **A bottom sheet** on phones in place of a dropdown or a modal.
- **A draggable sheet** that follows the finger and dismisses on a flick.

Open: [overlays.md, Drawer and sheet](../overlays.md#drawer-and-sheet); [motion](../protocols/motion.md), step 4.

## Popover and dropdown

Applies when: a panel opens from a control; a dropdown is clipped or detached from its trigger; a menu appears from the centre of the screen.

Build: A panel anchored to its trigger and mounted outside any clipping ancestor, through the `popover` attribute or a portal, flipping to the side with room; Escape closes it and returns focus.

Options:

- **A popover anchored to its trigger**, growing from it, flipping to the side with room.
- **A portal** when an ancestor clips overflow.
- **A sheet** on phones when the content is more than a few items.

Open: [forms-and-inputs](../protocols/forms-and-inputs.md), step 4; [overlays.md, Popover and menu](../overlays.md#popover-and-menu).

## Toast

Applies when: an action confirms itself; a notification appears; toasts stack; an error is shown as a toast.

Build: A status region in the page from the first load, toasts appended inside it at one bottom corner, timed and paused as [overlays.md](../overlays.md#toast) sets out, a close button, and an undo when the action can be reversed.

Options:

- **A toast** for a result that needs no answer, with an undo when the action is reversible.
- **Inline at the field** for form errors.
- **A banner in the page** for a persistent condition, such as being offline.

Open: [overlays.md, Toast](../overlays.md#toast); [interface-states](../protocols/interface-states.md), step 5.

## Tooltip

Applies when: an icon-only control needs its name; a tooltip holds instructions; tooltips open slowly across a toolbar.

Build: Shown on hover and on focus of its trigger after a short delay, linked by `aria-describedby`, holding no control, hidden by Escape, with the same words reachable another way on touch.

Options:

- **A tooltip that names** a control, on hover and on focus.
- **Text on the page** when the content is needed to proceed.
- **A first-use hint** that points at a new feature once and never returns after dismissal.

Open: [overlays.md, Tooltip](../overlays.md#tooltip); [animation.md, Recipes](../animation.md#recipes); [states.md, Onboarding](../states.md#onboarding).

## Banners and consent

Applies when: a cookie or consent banner, an announcement bar or a system notice is added.

Build: Only when there is something to consent to or announce: a region at the page edge that never covers the primary action, Accept and Reject as equal buttons of one press each, the most private choice preselected, nothing non-essential loaded or set before the choice, a link to the cookie notice, the choice stored and reopened from the footer, and the dismissal remembered.

Options:

- **No banner** when there is nothing to consent to.
- **A consent banner** that preselects the most private choice, offers Reject as plainly as Accept and never covers the primary action.
- **A footer link that reopens the choice**, so withdrawing is as easy as giving.
- **An announcement bar** that can be dismissed and stays dismissed.

Open: [overlays.md, Banners and consent](../overlays.md#banners-and-consent); [site-polish.md](../site-polish.md); [forms-and-inputs](../protocols/forms-and-inputs.md), step 9; step 3 of the security module's personal-data protocol for what loads before the choice; when that module is not installed, the rule is the Build line: no non-essential script, cookie or request before the choice, and none after a decline.

## Permission requests

Applies when: the product asks for the camera, the microphone, the location, notifications, contacts or the clipboard; a browser or system prompt appears on page load; a denied permission breaks the screen.

Build: Ask at the moment the feature needs it, after the person's own action, never on load. Before the browser or system prompt, a short in-page explanation says what is asked and what the person gets, with two buttons of equal weight; the prompt opens only after the person agrees. A denial leaves the rest of the screen working, says what is lost and how to turn it on in the browser or system settings, and the request does not return in the same session.

Options:

- **An in-page explanation first**, the default.
- **The system prompt alone** when the person's action already says why, such as pressing *Use my location*.
- **A manual alternative** beside it, such as typing an address instead of sharing the location.

Open: [overlays.md, Choosing the kind](../overlays.md#choosing-the-kind); [forms-and-controls.md, Honest choices](../forms-and-controls.md#honest-choices); [microcopy.md, Permission requests](../../copy/microcopy.md#permission-requests) for the words.
