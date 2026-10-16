# T064 screen captures

Date: 2026-10-16

The saved files come from three source revisions:

| Source commit | Saved PNGs | Destinations |
| --- | --- | --- |
| e8e6b40697bda1b6d76a599036956872ebfbe58a | 187 | Every destination except the ones below, recaptured after the QA fixes (3.1 es, 3.4 es and 6.12 en reached on a second run of the same revision). |
| f9a553184d2a2ca3c61cb1bcdab0675fa6bfccca | 2 | 4.9 in English and Spanish, recaptured once the Attach agents picker listed agents that load after it opened. |
| 09585c5e14563f97aec5a6a2574b00d315ac0dbd | 2 | 7.7 in English and Spanish, kept from the first run. |

Chrome: Chrome/155.0.8059.80

Captured: 191

Unreached: 2

These are capture records for the Overmind's later visual verification, not visual acceptance.

Kept from an earlier run:

- 7.7 en and 7.7 es. After Home access is closed the phone shows "The service is unavailable." instead of the ended state the case waits for; the saved files are the earlier ones from 09585c5 and do not show the current product. To check in the live test.

Never saved, because the product does not show that state here:

- start 2.5 en and start 2.5 es. Lyra is not in the Runs in picker: the local service reports lyra_offline, so there is no connected Lyra model to select.
