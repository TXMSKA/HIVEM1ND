project: myapp
family: shop
stage: beta
updated: 2026-09-15
voice: docs/voice.md
board: docs/flows/boards/index.json

## Problem and audience
Owners of small shops who write a blog and have no developer: changing a post or recovering a lost password means asking someone.

## Value
The owner edits posts and recovers access alone, from /admin.

## Requirements

### Alpha
- APP-A-01: the owner creates, edits and deletes a post from /admin. Accepted when: a post created in /admin shows on the public blog after a reload and is gone after deletion.

### Beta
- APP-B-04: a user who forgot the password sets a new one by mail. Accepted when: a reset request sends one mail, its link opens the form once, and the new password logs in.

### Release
- APP-R-01: every post reads with scripts blocked. Accepted when: each post opens and shows its full text in a browser with scripts disabled.

## Out of scope
- Comments from readers.

## Plans
Free and Plus. The prices are in the price table of `projects/shop/product.md`.

## Floors
- Local first: a draft survives a lost connection and is saved when it returns.
- Privacy: no third-party script on the public blog.
- Weak devices: the public blog is usable on a five-year-old phone.
- Platforms: current desktop and phone browsers.

## Depends on
- Products: shop-checkout
- Shared contracts: sign-in

## Open questions
- Does a reset link expire after one hour or after a day?

## Annexes
- architecture: annexes/architecture.md
