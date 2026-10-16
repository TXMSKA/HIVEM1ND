# T064 screen captures

Date: 2026-10-16

The saved files come from three source revisions:

| Source commit | Saved PNGs | Destinations |
| --- | --- | --- |
| 22451d187dd240390b51eacfeff4165ee9e61272 | 177 | Every destination except the ones below, recaptured after the Overmind's own visual fixes (Map controls, status line, inspector, composer, notices, cluster glyphs, copy, Void spacing, empty start). |
| d4afbac939cfbc5ba9f8c7448a8be7d0be44251b | 12 | 1.7, 2.1, 3.8, 4.9, 6.10 and 6.12, each in English and Spanish, recaptured once the capture cases knew the new zoom group and the first-message composer. |
| 09585c5e14563f97aec5a6a2574b00d315ac0dbd | 2 | 7.7 in English and Spanish, kept from the first run. |

Chrome: Chrome/155.0.8059.80

Captured: 191

Unreached: 2

These are capture records for the Overmind's later visual verification, not visual acceptance.

Kept from an earlier run:

- 7.7 en and 7.7 es. After Home access is closed the phone shows "The service is unavailable." instead of the ended state the case waits for; the saved files are the earlier ones from 09585c5 and do not show the current product. To check in the live test.

Never saved, because the product does not show that state here:

- start 2.5 en and start 2.5 es. Lyra is not in the Runs in picker: the local service reports lyra_offline, so there is no connected Lyra model to select.
