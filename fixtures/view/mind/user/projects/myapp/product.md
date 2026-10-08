project: myapp
family: none
stage: beta in build
updated: 2026-10-08
voice: none
board: none

## Problem and audience
Owners of small shops who write a blog and have no developer.

## Value
The owner edits posts and recovers access alone, from /admin.

## Requirements

### Alpha
- APP-A-01: the owner creates, edits and deletes a post from /admin. Accepted when: a post created in /admin shows on the public blog after a reload.
- APP-A-02: a draft survives a lost connection. Accepted when: a draft typed offline is saved when the connection returns.

### Beta (the first public release)
- APP-B-04: a user who forgot the password sets a new one by mail. Accepted when: a reset request sends one mail and the new password logs in.
- APP-B-05: the site publishes a sitemap. Accepted when: /sitemap.xml lists every post.

### Release
- APP-R-01: every post reads with scripts blocked. Accepted when: each post shows its full text with scripts disabled.

## Out of scope
- Comments from readers.

## Plans
Free and Plus.

## Floors
- Local first: a draft survives a lost connection.
- Privacy: no third-party script on the public blog.
- Weak devices: the public blog is usable on a five-year-old phone.
- Platforms: current desktop and phone browsers.

## Depends on
- Products: none
- Shared contracts: none

## Open questions
- Does a reset link expire after one hour or after a day?

## Annexes
- architecture: annexes/architecture.md
