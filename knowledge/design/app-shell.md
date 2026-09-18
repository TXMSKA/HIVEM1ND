# App shell

The anatomy of an admin, an editor or a management panel. Every value in it comes from the tokens of the project that implements it: the shell is copied as structure, never as a stylesheet, so a re-skin stays one file and a brand never forks the shell.

## Rail

- **Fixed rail on the start side, content beside it.** About 15rem wide. The top holds the product mark with a short label next to it, the middle holds the navigation, and the foot holds the identity block pinned to the bottom.
- **Collapse, do not hide.** Below about 900 CSS pixels the rail narrows to about 4rem and keeps only the icons. Every icon then carries an accessible name, and a tooltip names it on hover and on focus.
- **Identity at the foot.** A round avatar, the person's name, their role in a small secondary style, and the sign-out action, all in one block that never scrolls away.

## Navigation link

- **Icon plus label**, a medium radius and enough vertical padding that each row clears the target size in [accessibility](protocols/accessibility.md).
- **Active state on three cues at once.** A raised surface behind the row, the title text colour, and the icon in the accent. A short accent pill, about 3 pixels wide, hugs the start edge of the active row. It is drawn as a pseudo-element rather than as a border, so it does not fight the rounded corner, and it is the one place where a coloured edge marks selection.
- **The current page is announced**, not only coloured: the active link carries the current-page state for assistive technology.

## Overview

- **A lead panel on top.** A large radius, the raised surface, a subtle border, a short label naming the area, a large title and one status line that says what is going on.
- **A card grid below it.** Columns that fit as many cards as the width allows at a minimum of about 280 CSS pixels each, so the grid reflows without breakpoints. Each card opens with a small label naming its kind, and its figures sit on a sunken surface with the label above and the number in the display face with tabular numerals.
- **One concept per card**, with the card rules of [dashboards.md](dashboards.md).

## Lists and choices

- **Rows, not a ruled table, when the content is a list of things.** Each row is a block with a radius and a raised hover surface, with its metadata in a small secondary style. A table stays a table when the reader compares values across columns.
- **Choosing a content type is a set of cards, not a select.** Each option shows an icon, a name and one line that says what it produces, so the choice is made by recognition rather than by reading a menu.

## Never

- A colour, a font or a shadow written into the shell instead of read from the tokens.
- One shell per brand. A brand is a token override on a wrapper around the same shell.
- A shared shell package that carries a brand colour, brand copy or a brand mark. It stays visually neutral because it renders inside more than one brand, and a hosted app tints it through tokens on the root.
