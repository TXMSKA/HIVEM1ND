# Overlays

Anything that sits above the page: a modal, a drawer or sheet, a popover or menu, a toast, a tooltip. Each one interrupts, so the first decision is whether it should exist at all, and the second is which kind interrupts least for the job. Motion values are in [animation.md](animation.md); focus and keyboard checks run in [accessibility](protocols/accessibility.md).

## Choosing the kind

| Job | Overlay | Why |
| --- | --- | --- |
| A decision that blocks everything else, or a destructive confirmation | Modal | It protects focus and demands an answer |
| A secondary task reached from several places, such as a contact form, filters or a detail | Drawer or sheet | It keeps the page in view behind it and closes back to where the person was |
| A short choice or a few fields tied to one control | Popover or menu | It stays next to what it changes |
| The result of an action that needs no answer | Toast | It confirms without stopping the work |
| The name or the shortcut of a control | Tooltip | It adds a word, never content that is needed |
| Content the person must read to continue | The page itself | An overlay is the wrong container for it |

A modal for a task that needs neither interruption nor protected focus is a default, not a choice. A confirmation is reserved for what is destructive or irreversible; everywhere else an undo is cheaper, because frequent confirmations teach people to click through them.

## Modal

- Focus moves into the modal on open, stays trapped inside it, and returns to the control that opened it on close. When that control no longer exists, such as the delete button of a row just deleted, focus goes to the next logical control: the same control in the next row, else in the previous row, else the heading or the result summary of the list.
- Built on the native `dialog` element opened with `showModal()`, which gives the backdrop, the inert page and Escape; a custom modal adds each of them by hand.
- Escape closes it, and so does a click on the backdrop unless closing would lose entered data. `showModal()` does not close on a backdrop click: the dialog gets `closedby="any"`, or a click handler on the dialog itself that closes it when the click lands on the dialog element rather than on its content, with the handler kept for browsers that ignore the attribute.
- The backdrop dims and pushes the page back; a stacked modal dims its parent in turn.
- The title names what is happening, and a destructive confirmation names the object and the consequence, with the destructive action labelled by its verb.
- The page behind does not scroll while it is open.
- On a phone a long modal becomes a full-height sheet.

## Drawer and sheet

- It slides from the edge it belongs to and leaves through the same edge.
- Once it can be dragged, it follows the finger, dismisses on a flick, and a person who grabs it while it closes takes it back.
- A drawer opened from several entry points behaves the same from each.
- Focus returns to the control that opened it, which is easy to lose on a drawer opened from a menu that has since closed.

## Popover and menu

- It grows from the control that opened it and stays anchored to that control on scroll and resize.
- It mounts outside any ancestor that clips overflow, and flips to the side with room.
- Escape closes it and returns focus; a click outside closes it without acting.
- The rules for long option lists and multi-selects are in [forms-and-controls.md](forms-and-controls.md).

## Toast

- It confirms, it does not ask. Anything that needs a decision is not a toast.
- It appears in one consistent corner, stacks without covering the primary action, and is announced through a live region with the status role that is already in the page before the toast arrives.
- It is a layer, not a section, so it may take an inverse surface, dark on a light page and light on a dark one, as its own semantic pair measured in each theme.
- Its timer pauses while the tab is hidden and while the pointer or focus rests on it, and it can be dismissed by hand.
- A toast that carries an undo stays long enough to use it.
- Errors in a form are shown inline at the field, not as a toast.

## Tooltip

- It names, it does not explain. A tooltip that holds a sentence someone needs belongs on the page.
- It opens on hover and on keyboard focus, after a short delay for the first one, and at once for its neighbours while one is already open.
- It never holds an interactive element, and it can be dismissed with escape without moving focus.
- On touch there is no hover, so anything a tooltip says is also reachable another way.

## Banners and consent

A cookie or consent banner appears only when tracking, jurisdiction or compliance demands it, never covers the primary action on a phone, and preselects the most private choice.
