# T064 screen captures

Date: 2026-10-16

The saved files come from four source revisions; the last one replaces almost all earlier files:

| Source commit | Saved PNGs | Destinations |
| --- | --- | --- |
| 09585c5e14563f97aec5a6a2574b00d315ac0dbd | 127 | All present destinations except the follow-ups below. |
| 1a278b2edc413abab4ba61655386cb14c073cd66 | 10 | 1.8, 1.9, 7.1, 7.2 and 7.3, each in English and Spanish. |
| f4c7c76ac5eea5e4cec53392678c1a78ba6816b7 | 54 | 2.2, 2.3, 2.4, 2.5, 2.6, 2.15, 2.16, 2.17, 2.18, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 6.10, 6.12, start 1.3, start 3.1, start 3.2, start 4.1 and start 4.2, each in English and Spanish. |
| d360720 | 189 | Every destination except 7.7 in English and Spanish and start 2.5, recaptured after the visual review fixes (the inspector, Map, Hierarchy, bar, buttons, comments, plans, History, looks, copy and the board parity dialogs). |

Chrome: Chrome/155.0.8059.80

Captured: 189 at d360720, plus 7.7 in English and Spanish kept from 09585c5

Unreached at d360720: 4

These are capture records for the Overmind's later visual verification, not visual acceptance. The third revision recaptures the agent inspector and slow-notice references. Other files from the first run have not been recaptured.

Not recaptured at d360720:

- 7.7 en and 7.7 es. After Home access is closed the phone shows "The service is unavailable." instead of the ended state the case waits for; the saved files are the earlier ones from 09585c5 and do not show the current product. To check in the live test.

Never saved, because the product does not show that state here:

- start 2.5 en and start 2.5 es. Lyra is not in the Runs in picker: the local service reports lyra_offline, so there is no connected Lyra model to select.
