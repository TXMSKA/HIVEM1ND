# GUI browser checks

Chrome headless against the isolated fixture on 10 October 2026. Captures are in `%TEMP%\hivem1nd-3-fix-gui\`. Rows below are from that run. A phone camera was not available.

## Shell, looks, and viewports

| Viewport | Look | Language | Result | Observed | Failure | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1440x900 | modern | en | pass | Background rgb(15, 11, 19), accent #bdcd79, radius 20px. Bar 1440x52, footer 1440x30, side 266x806, stage 760x806, inspector 366x806. Map circles 56x56 with radius 50% and a Connect handle. Copy included Map, Blueprint, Document, Focus, 5 waiting, Hierarchy, 11 units, 5 unread, 3 issues, Service on DESKTOP, Saved on this machine, Last read 12:00 UTC. Hash empty, storage 0. | none | 1440-modern-en-map.png |
| 1440x900 | high-contrast | en | pass | Background rgb(5, 5, 5), accent #d4b06a, radius 10px. Circle 56x56, radius 50%, handle Connect. Blueprint columns 240px 772px 380px. | none | 1440-contrast-en-map.png, 1440-contrast-en-blueprint.png |
| 1440x900 | modern | es | pass | Look stayed modern. Handle Conectar, status En espera. Copy included Mapa, Documento, Concentración, 5 pendientes, Jerarquía, 11 unidades. | none | 1440-modern-es-map.png |
| 1024x768 | modern | en | pass | Layout stayed desktop. Bar 1024x52, side 266x674. Map only. | none | 1024-modern-en-map.png |
| 720x450, device scale 2 | modern | en | pass | visualViewport.scale 2 and deviceScaleFactor 2. | none | 720-scale2-modern-en-map.png |
| 390x844 | modern | en | pass | Layout phone. Modes Hierarchy, Chats, Waiting. No new unit, no pin, hash empty, storage 0, no stage, and the body did not include "This screen is not ready yet." | none | 390-modern-en-phone.png |
| 1440x900 | modern | en | pass | prefers-reduced-motion matched and a 1s transition computed as 0s. | none | browser |
| 1440x900 | modern | en | pass | prefers-contrast: more matched. The look stayed modern. High contrast remains the Settings choice. | none | browser |
| 1440x900 | mixed | mixed | pass | Desktop console errors empty. Desktop failed requests empty, including the mark icon. | none | cdp |
| 390x844 | modern | en | pass | Phone console errors empty. Phone failed requests empty. | none | 390-modern-en-phone.png |

## Screens

| Viewport | Look | Language | Result | Observed | Failure | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1440x900 | modern | en | pass | Chats, Hierarchy, and Waiting opened from their controls. | none | 1440-modern-en-chats.png, 1440-modern-en-hierarchy.png, 1440-modern-en-waiting.png |
| 1440x900 | modern | en | pass | Blueprint columns 228px 796px 368px. | none | 1440-modern-en-blueprint.png |
| 1440x900 | modern | en | pass | Document opened Release notes. | none | 1440-modern-en-document.png |
| 1440x900 | modern | en | pass | Focus background rgb(0, 0, 0). Bar, footer, and tools hidden. Text was Welcome and a first paragraph. Pointer movement showed the tools. Escape returned to Document. | none | 1440-modern-en-focus.png |
| 1440x900 | modern | en | pass | One map drag moved master from left 698 to 778. | none | 1440-modern-en-drag.png |

## Lists

| Viewport | Look | Language | Result | Observed | Failure | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1440x900 | modern | en | pass | 1 extra item: total 12, mounted rows 17. | none | browser |
| 1440x900 | modern | en | pass | 4 extra items: total 15, mounted rows 17. | none | browser |
| 1440x900 | modern | en | pass | 40 extra items: total 51, mounted rows 17. | none | browser |
| 1440x900 | modern | en | pass | 400 extra items: total 411, mounted rows 17. | none | 1440-size-400.png |
| 1440x900 | modern | en | pass | 1200 extra items: total 1211. Four bulk rows were mounted before the fold opened, then 10, still under 100. End focused root:incubator at position 1216 of 1216 inside the pane, with 17 rows mounted. Search unit-1200 showed 1 listed and that row inside the pane. | none | 1440-large-end.png, 1440-large-search.png |

## Stream, sessions, and review

| Viewport | Look | Language | Result | Observed | Failure | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1440x900 | modern | en | pass | Offline stream: footer sync text included Sync needs attention. | none | 1440-offline.png |
| 1440x900 | modern | en | pass | Replay of a slowing event left the pending count at 3. | none | browser |
| 1440x900 | modern | en | pass | After the stream reset, the shell stayed up, the gate stayed closed, and the total stayed 11. | none | browser |
| 1440x900 | modern | en | pass | The session request note was exactly The session request expired. | none | browser |
| 1440x900 | modern | en | pass | A session went from The session is queued. to The session failed. Nothing was launched. | none | 1440-session.png |
| 1440x900 | modern | en | pass | The shop machine form read No client is available on that machine. and confirm was disabled. | none | browser |
| 1440x900 | modern | en | pass | Stop went from The session is stopping. to The session stopped. | none | browser |
| 1440x900 | modern | en | pass | Two local drags moved master from 698 to 778 and from 330 to 370 while a remote layout event was applied. | none | 1440-two-drags.png |
| 1440x900 | modern | en | pass | Confirm copy was adjutant will report to overseer. Cancel left the previous note unchanged. Confirm then named adjutant and overseer. | none | 1440-connect.png |
| 1440x900 | modern | en | pass | Group connect named adjutant and executive, then cancel left the connection unsent. | none | browser |
| 1440x900 | modern | en | pass | Task 030 accept was disabled. Task 029 accept was enabled. An expired approval stayed visible. | none | browser |
| 1440x900 | modern | en | pass | Approve showed Answer queued. and the approval state became approved. The note did not become Denied. | none | browser |
| 1440x900 | modern | en | pass | After an outside edit, undo on task 029 reported data-code undo_conflict. | none | browser |
| 1440x900 | modern | en | pass | A late message appeared in the open transcript. Unlist removed the row, kept reopen, and set listed false. | none | browser |
| 1440x900 | modern | en | not observed | A dropped mutation and a stale layout conflict were not driven. No retry control was looked for. | not exercised | none |

## Document, Watch, home, phone, embeds

| Viewport | Look | Language | Result | Observed | Failure | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1440x900 | modern | en | pass | Release notes showed Welcome, no script element in the workspace, and 2 Accept change controls. Focus was rgb(0, 0, 0) with tools hidden. Escape returned to Document. | none | browser |
| 1440x900 | modern | en | not observed | Plain-offset editing, an emoji save, and a stale proposal answer were not driven. | not exercised | none |
| 1440x900 | modern | en | not observed | Unknown board fields were not edited. Blueprint was opened for columns and Watch only. | not exercised | none |
| 1440x900 | modern | en | not observed | An image upload was not performed. The mark icon request did not fail. | not exercised | cdp |
| 1440x900 | modern | en | pass | Watch showed Waiting for or Watching, then Following is off. | none | browser |
| 1440x900 | modern | en | pass | Replace home warned that replacing access revokes the current key, code, and phone sessions. One QR and two links appeared. After 12 hours the grant was closed and the symbol was gone. | none | 1440-home-qr.png |
| 1440x900 | modern | en | unavailable | A phone camera was not available, so the symbol was not scanned. | unavailable | 1440-home-qr.png |
| 390x844 | modern | en | pass | No new unit, pin, undo, revoke, or settings. Hash empty, storage 0. An existing chat accepted Phone note. An accept control was not on that Waiting screen, so a task review was not performed. | none | 390-phone-actions.png |
| 1440x900 | high-contrast and modern | es and en | pass | One embed changed to high contrast and Spanish. The other stayed modern, English, and desktop. Closing one showed the Spanish reopen sentence and left the other connected. | none | browser |

## T062 automated accessibility evidence, 14 October 2026

This task was executed without a browser, Computer Use or screenshots, as instructed. The older browser observations above remain historical. The rows below are sRGB calculations from the committed CSS plus the T062 corrections, and CSS hit-box contracts, not observed browser rectangles or screen-reader output. Visual matching, actual rectangles, 200% zoom, native keyboard behavior and screen-reader observations remain with the Overmind in T064; T091/T093/T094 extend the inventory to their new start-board states. No new capture exists for T062.

Contrast uses unrounded sRGB channels, source-over alpha compositing and the WCAG relative-luminance transfer function. Ratio is (lighter + 0.05)/(darker + 0.05). RGB columns retain six decimal places; the assertions compare unrounded ratios against 4.5. Disabled hints and controls retain opacity 1, so their readable text uses the same measured roles. Pure-black Focus and black/white QR colors remain unchanged.

The matrix measures mute, body and text on every base surface and the conservative envelope of each existing soft fill over panel/card/card2. This includes combinations without a currently visible text node, so future states can reuse the same floor. Toxic body alpha 0.88 is composited independently on every background. All 36 parent/preview look combinations are checked to ensure that a preview starts from Modern defaults and applies its own local overrides, including surfaces, hints and line hues.

Measured corrections preserve each muted hue by adding the smallest whole-number channel offset that meets this envelope after the Nocturne fill correction. No container line or border is brightened. Nocturne ring-soft changes from rgba(212, 176, 106, 0.45) to rgba(212, 176, 106, 0.14); its previous mute over ring-soft/card2 measured 1.856273:1. The six muted corrections and minima are:

| Look | Previous mute | Corrected mute | Previous minimum | Corrected minimum |
| --- | --- | --- | --- | --- |
| modern | #aa9fb1 | #aca1b3 | 4.408699 | 4.514723 |
| high-contrast | #8f8b85 | #9b9791 | 1.856273 | 4.519973 |
| nebula | #a38f92 | #a99598 | 4.177398 | 4.724488 |
| txmska | #a493c2 | #a998c7 | 4.253706 | 4.738233 |
| coffee-cat | #d6d2dc | #e6e2ec | 3.889283 | 4.517026 |
| ntk | #a79e93 | #b8afa4 | 3.707133 | 4.741973 |

Selector/state mapping for the measured surfaces:

| Surface | Selector/state covered |
| --- | --- |
| bg | .foot, .opening-counts, phone-code feedback |
| panel | .field-hint, .chat-members, .settings-section headings/hints, disabled Settings controls |
| card | .bubble-meta, .library-count on a selected row, .settings-agent-row, disabled comment preferences |
| card2 | .library-toast countdown, .settings-machine-menu offline hint, .board-screen-title |
| ground | Void surface, map/editor surroundings and preview map |
| me | Own-palette preview bubble surface |
| accent-soft/panel, accent-soft/card, accent-soft/card2 | Checked .library-create-option hint, .library-chip, .library-menu-row checked; conservative fill envelope |
| waiting-soft/panel, waiting-soft/card, waiting-soft/card2 | .settings-offline, .board-conflict, stale .void-suggestion, delayed activity; conservative fill envelope |
| ring-soft/panel, ring-soft/card, ring-soft/card2 | .map-personal-zone and labels over a zone; conservative fill envelope |
| error-soft/panel, error-soft/card, error-soft/card2 | .void-save-error, opening/phone errors and their hints; conservative fill envelope |
| focus-black | .void-focus-hint and Focus body/text on #000000 |

### Exact contrast matrix

| Look | Role | Surface/state | Raw foreground | Composited background RGB | Composited foreground RGB | Ratio |
| --- | --- | --- | --- | --- | --- | --- |
| modern | mute | bg | #aca1b3 | 15.000000, 11.000000, 19.000000 | 172.000000, 161.000000, 179.000000 | 7.890813 |
| modern | body | bg | #d4ccd8 | 15.000000, 11.000000, 19.000000 | 212.000000, 204.000000, 216.000000 | 12.461331 |
| modern | text | bg | #f5f1f6 | 15.000000, 11.000000, 19.000000 | 245.000000, 241.000000, 246.000000 | 17.442148 |
| modern | mute | panel | #aca1b3 | 24.000000, 18.000000, 29.000000 | 172.000000, 161.000000, 179.000000 | 7.438542 |
| modern | body | panel | #d4ccd8 | 24.000000, 18.000000, 29.000000 | 212.000000, 204.000000, 216.000000 | 11.747094 |
| modern | text | panel | #f5f1f6 | 24.000000, 18.000000, 29.000000 | 245.000000, 241.000000, 246.000000 | 16.442430 |
| modern | mute | card | #aca1b3 | 33.000000, 26.000000, 39.000000 | 172.000000, 161.000000, 179.000000 | 6.847765 |
| modern | body | card | #d4ccd8 | 33.000000, 26.000000, 39.000000 | 212.000000, 204.000000, 216.000000 | 10.814127 |
| modern | text | card | #f5f1f6 | 33.000000, 26.000000, 39.000000 | 245.000000, 241.000000, 246.000000 | 15.136554 |
| modern | mute | card2 | #aca1b3 | 43.000000, 34.000000, 50.000000 | 172.000000, 161.000000, 179.000000 | 6.172396 |
| modern | body | card2 | #d4ccd8 | 43.000000, 34.000000, 50.000000 | 212.000000, 204.000000, 216.000000 | 9.747572 |
| modern | text | card2 | #f5f1f6 | 43.000000, 34.000000, 50.000000 | 245.000000, 241.000000, 246.000000 | 13.643695 |
| modern | mute | ground | #aca1b3 | 19.000000, 14.000000, 23.000000 | 172.000000, 161.000000, 179.000000 | 7.709848 |
| modern | body | ground | #d4ccd8 | 19.000000, 14.000000, 23.000000 | 212.000000, 204.000000, 216.000000 | 12.175546 |
| modern | text | ground | #f5f1f6 | 19.000000, 14.000000, 23.000000 | 245.000000, 241.000000, 246.000000 | 17.042135 |
| modern | mute | me | #aca1b3 | 58.000000, 44.000000, 67.000000 | 172.000000, 161.000000, 179.000000 | 5.244790 |
| modern | body | me | #d4ccd8 | 58.000000, 44.000000, 67.000000 | 212.000000, 204.000000, 216.000000 | 8.282678 |
| modern | text | me | #f5f1f6 | 58.000000, 44.000000, 67.000000 | 245.000000, 241.000000, 246.000000 | 11.593280 |
| modern | mute | accent-soft/panel | #aca1b3 | 47.100000, 44.180000, 41.880000 | 172.000000, 161.000000, 179.000000 | 5.603059 |
| modern | body | accent-soft/panel | #d4ccd8 | 47.100000, 44.180000, 41.880000 | 212.000000, 204.000000, 216.000000 | 8.848464 |
| modern | text | accent-soft/panel | #f5f1f6 | 47.100000, 44.180000, 41.880000 | 245.000000, 241.000000, 246.000000 | 12.385212 |
| modern | mute | accent-soft/card | #aca1b3 | 54.840000, 51.060000, 50.480000 | 172.000000, 161.000000, 179.000000 | 5.052255 |
| modern | body | accent-soft/card | #d4ccd8 | 54.840000, 51.060000, 50.480000 | 212.000000, 204.000000, 216.000000 | 7.978622 |
| modern | text | accent-soft/card | #f5f1f6 | 54.840000, 51.060000, 50.480000 | 245.000000, 241.000000, 246.000000 | 11.167693 |
| modern | mute | accent-soft/card2 | #aca1b3 | 63.440000, 57.940000, 59.940000 | 172.000000, 161.000000, 179.000000 | 4.514723 |
| modern | body | accent-soft/card2 | #d4ccd8 | 63.440000, 57.940000, 59.940000 | 212.000000, 204.000000, 216.000000 | 7.129741 |
| modern | text | accent-soft/card2 | #f5f1f6 | 63.440000, 57.940000, 59.940000 | 245.000000, 241.000000, 246.000000 | 9.979511 |
| modern | mute | waiting-soft/panel | #aca1b3 | 48.720000, 38.880000, 38.840000 | 172.000000, 161.000000, 179.000000 | 5.876613 |
| modern | body | waiting-soft/panel | #d4ccd8 | 48.720000, 38.880000, 38.840000 | 212.000000, 204.000000, 216.000000 | 9.280465 |
| modern | text | waiting-soft/panel | #f5f1f6 | 48.720000, 38.880000, 38.840000 | 245.000000, 241.000000, 246.000000 | 12.989884 |
| modern | mute | waiting-soft/card | #aca1b3 | 56.640000, 45.920000, 47.640000 | 172.000000, 161.000000, 179.000000 | 5.302785 |
| modern | body | waiting-soft/card | #d4ccd8 | 56.640000, 45.920000, 47.640000 | 212.000000, 204.000000, 216.000000 | 8.374264 |
| modern | text | waiting-soft/card | #f5f1f6 | 56.640000, 45.920000, 47.640000 | 245.000000, 241.000000, 246.000000 | 11.721473 |
| modern | mute | waiting-soft/card2 | #aca1b3 | 65.440000, 52.960000, 57.320000 | 172.000000, 161.000000, 179.000000 | 4.734383 |
| modern | body | waiting-soft/card2 | #d4ccd8 | 65.440000, 52.960000, 57.320000 | 212.000000, 204.000000, 216.000000 | 7.476632 |
| modern | text | waiting-soft/card2 | #f5f1f6 | 65.440000, 52.960000, 57.320000 | 245.000000, 241.000000, 246.000000 | 10.465056 |
| modern | mute | ring-soft/panel | #aca1b3 | 43.600000, 34.800000, 49.440000 | 172.000000, 161.000000, 179.000000 | 6.123912 |
| modern | body | ring-soft/panel | #d4ccd8 | 43.600000, 34.800000, 49.440000 | 212.000000, 204.000000, 216.000000 | 9.671005 |
| modern | text | ring-soft/panel | #f5f1f6 | 43.600000, 34.800000, 49.440000 | 245.000000, 241.000000, 246.000000 | 13.536524 |
| modern | mute | ring-soft/card | #aca1b3 | 51.340000, 41.680000, 58.040000 | 172.000000, 161.000000, 179.000000 | 5.556155 |
| modern | body | ring-soft/card | #d4ccd8 | 51.340000, 41.680000, 58.040000 | 212.000000, 204.000000, 216.000000 | 8.774391 |
| modern | text | ring-soft/card | #f5f1f6 | 51.340000, 41.680000, 58.040000 | 245.000000, 241.000000, 246.000000 | 12.281531 |
| modern | mute | ring-soft/card2 | #aca1b3 | 59.940000, 48.560000, 67.500000 | 172.000000, 161.000000, 179.000000 | 4.984142 |
| modern | body | ring-soft/card2 | #d4ccd8 | 59.940000, 48.560000, 67.500000 | 212.000000, 204.000000, 216.000000 | 7.871058 |
| modern | text | ring-soft/card2 | #f5f1f6 | 59.940000, 48.560000, 67.500000 | 245.000000, 241.000000, 246.000000 | 11.017135 |
| modern | mute | error-soft/panel | #aca1b3 | 48.600000, 32.880000, 40.400000 | 172.000000, 161.000000, 179.000000 | 6.179456 |
| modern | body | error-soft/panel | #d4ccd8 | 48.600000, 32.880000, 40.400000 | 212.000000, 204.000000, 216.000000 | 9.758720 |
| modern | text | error-soft/panel | #f5f1f6 | 48.600000, 32.880000, 40.400000 | 245.000000, 241.000000, 246.000000 | 13.659299 |
| modern | mute | error-soft/card | #aca1b3 | 56.520000, 39.920000, 49.200000 | 172.000000, 161.000000, 179.000000 | 5.600385 |
| modern | body | error-soft/card | #d4ccd8 | 56.520000, 39.920000, 49.200000 | 212.000000, 204.000000, 216.000000 | 8.844240 |
| modern | text | error-soft/card | #f5f1f6 | 56.520000, 39.920000, 49.200000 | 245.000000, 241.000000, 246.000000 | 12.379300 |
| modern | mute | error-soft/card2 | #aca1b3 | 65.320000, 46.960000, 58.880000 | 172.000000, 161.000000, 179.000000 | 5.014086 |
| modern | body | error-soft/card2 | #d4ccd8 | 65.320000, 46.960000, 58.880000 | 212.000000, 204.000000, 216.000000 | 7.918345 |
| modern | text | error-soft/card2 | #f5f1f6 | 65.320000, 46.960000, 58.880000 | 245.000000, 241.000000, 246.000000 | 11.083322 |
| modern | mute | focus-black | #aca1b3 | 0.000000, 0.000000, 0.000000 | 172.000000, 161.000000, 179.000000 | 8.503014 |
| modern | body | focus-black | #d8d4cc | 0.000000, 0.000000, 0.000000 | 216.000000, 212.000000, 204.000000 | 14.209106 |
| modern | text | focus-black | #f1efe9 | 0.000000, 0.000000, 0.000000 | 241.000000, 239.000000, 233.000000 | 18.263394 |
| high-contrast | mute | bg | #9b9791 | 5.000000, 5.000000, 5.000000 | 155.000000, 151.000000, 145.000000 | 7.016260 |
| high-contrast | body | bg | #c9c6bf | 5.000000, 5.000000, 5.000000 | 201.000000, 198.000000, 191.000000 | 11.950716 |
| high-contrast | text | bg | #f1efe9 | 5.000000, 5.000000, 5.000000 | 241.000000, 239.000000, 233.000000 | 17.725381 |
| high-contrast | mute | panel | #9b9791 | 11.000000, 11.000000, 11.000000 | 155.000000, 151.000000, 145.000000 | 6.775719 |
| high-contrast | body | panel | #c9c6bf | 11.000000, 11.000000, 11.000000 | 201.000000, 198.000000, 191.000000 | 11.541005 |
| high-contrast | text | panel | #f1efe9 | 11.000000, 11.000000, 11.000000 | 241.000000, 239.000000, 233.000000 | 17.117694 |
| high-contrast | mute | card | #9b9791 | 20.000000, 20.000000, 20.000000 | 155.000000, 151.000000, 145.000000 | 6.341934 |
| high-contrast | body | card | #c9c6bf | 20.000000, 20.000000, 20.000000 | 201.000000, 198.000000, 191.000000 | 10.802144 |
| high-contrast | text | card | #f1efe9 | 20.000000, 20.000000, 20.000000 | 241.000000, 239.000000, 233.000000 | 16.021811 |
| high-contrast | mute | card2 | #9b9791 | 27.000000, 27.000000, 27.000000 | 155.000000, 151.000000, 145.000000 | 5.929471 |
| high-contrast | body | card2 | #c9c6bf | 27.000000, 27.000000, 27.000000 | 201.000000, 198.000000, 191.000000 | 10.099601 |
| high-contrast | text | card2 | #f1efe9 | 27.000000, 27.000000, 27.000000 | 241.000000, 239.000000, 233.000000 | 14.979795 |
| high-contrast | mute | ground | #9b9791 | 5.000000, 5.000000, 5.000000 | 155.000000, 151.000000, 145.000000 | 7.016260 |
| high-contrast | body | ground | #c9c6bf | 5.000000, 5.000000, 5.000000 | 201.000000, 198.000000, 191.000000 | 11.950716 |
| high-contrast | text | ground | #f1efe9 | 5.000000, 5.000000, 5.000000 | 241.000000, 239.000000, 233.000000 | 17.725381 |
| high-contrast | mute | me | #9b9791 | 27.000000, 27.000000, 27.000000 | 155.000000, 151.000000, 145.000000 | 5.929471 |
| high-contrast | body | me | #c9c6bf | 27.000000, 27.000000, 27.000000 | 201.000000, 198.000000, 191.000000 | 10.099601 |
| high-contrast | text | me | #f1efe9 | 27.000000, 27.000000, 27.000000 | 241.000000, 239.000000, 233.000000 | 14.979795 |
| high-contrast | mute | accent-soft/panel | #9b9791 | 39.140000, 34.100000, 24.300000 | 155.000000, 151.000000, 145.000000 | 5.434642 |
| high-contrast | body | accent-soft/panel | #c9c6bf | 39.140000, 34.100000, 24.300000 | 201.000000, 198.000000, 191.000000 | 9.256763 |
| high-contrast | text | accent-soft/panel | #f1efe9 | 39.140000, 34.100000, 24.300000 | 241.000000, 239.000000, 233.000000 | 13.729692 |
| high-contrast | mute | accent-soft/card | #9b9791 | 46.880000, 41.840000, 32.040000 | 155.000000, 151.000000, 145.000000 | 4.917442 |
| high-contrast | body | accent-soft/card | #c9c6bf | 46.880000, 41.840000, 32.040000 | 201.000000, 198.000000, 191.000000 | 8.375822 |
| high-contrast | text | accent-soft/card | #f1efe9 | 46.880000, 41.840000, 32.040000 | 241.000000, 239.000000, 233.000000 | 12.423075 |
| high-contrast | mute | accent-soft/card2 | #9b9791 | 52.900000, 47.860000, 38.060000 | 155.000000, 151.000000, 145.000000 | 4.519973 |
| high-contrast | body | accent-soft/card2 | #c9c6bf | 52.900000, 47.860000, 38.060000 | 201.000000, 198.000000, 191.000000 | 7.698818 |
| high-contrast | text | accent-soft/card2 | #f1efe9 | 52.900000, 47.860000, 38.060000 | 241.000000, 239.000000, 233.000000 | 11.418937 |
| high-contrast | mute | waiting-soft/panel | #9b9791 | 35.120000, 30.800000, 22.400000 | 155.000000, 151.000000, 145.000000 | 5.658025 |
| high-contrast | body | waiting-soft/panel | #c9c6bf | 35.120000, 30.800000, 22.400000 | 201.000000, 198.000000, 191.000000 | 9.637249 |
| high-contrast | text | waiting-soft/panel | #f1efe9 | 35.120000, 30.800000, 22.400000 | 241.000000, 239.000000, 233.000000 | 14.294030 |
| high-contrast | mute | waiting-soft/card | #9b9791 | 43.040000, 38.720000, 30.320000 | 155.000000, 151.000000, 145.000000 | 5.132529 |
| high-contrast | body | waiting-soft/card | #c9c6bf | 43.040000, 38.720000, 30.320000 | 201.000000, 198.000000, 191.000000 | 8.742178 |
| high-contrast | text | waiting-soft/card | #f1efe9 | 43.040000, 38.720000, 30.320000 | 241.000000, 239.000000, 233.000000 | 12.966456 |
| high-contrast | mute | waiting-soft/card2 | #9b9791 | 49.200000, 44.880000, 36.480000 | 155.000000, 151.000000, 145.000000 | 4.721336 |
| high-contrast | body | waiting-soft/card2 | #c9c6bf | 49.200000, 44.880000, 36.480000 | 201.000000, 198.000000, 191.000000 | 8.041798 |
| high-contrast | text | waiting-soft/card2 | #f1efe9 | 49.200000, 44.880000, 36.480000 | 241.000000, 239.000000, 233.000000 | 11.927648 |
| high-contrast | mute | ring-soft/panel | #9b9791 | 39.140000, 34.100000, 24.300000 | 155.000000, 151.000000, 145.000000 | 5.434642 |
| high-contrast | body | ring-soft/panel | #c9c6bf | 39.140000, 34.100000, 24.300000 | 201.000000, 198.000000, 191.000000 | 9.256763 |
| high-contrast | text | ring-soft/panel | #f1efe9 | 39.140000, 34.100000, 24.300000 | 241.000000, 239.000000, 233.000000 | 13.729692 |
| high-contrast | mute | ring-soft/card | #9b9791 | 46.880000, 41.840000, 32.040000 | 155.000000, 151.000000, 145.000000 | 4.917442 |
| high-contrast | body | ring-soft/card | #c9c6bf | 46.880000, 41.840000, 32.040000 | 201.000000, 198.000000, 191.000000 | 8.375822 |
| high-contrast | text | ring-soft/card | #f1efe9 | 46.880000, 41.840000, 32.040000 | 241.000000, 239.000000, 233.000000 | 12.423075 |
| high-contrast | mute | ring-soft/card2 | #9b9791 | 52.900000, 47.860000, 38.060000 | 155.000000, 151.000000, 145.000000 | 4.519973 |
| high-contrast | body | ring-soft/card2 | #c9c6bf | 52.900000, 47.860000, 38.060000 | 201.000000, 198.000000, 191.000000 | 7.698818 |
| high-contrast | text | ring-soft/card2 | #f1efe9 | 52.900000, 47.860000, 38.060000 | 241.000000, 239.000000, 233.000000 | 11.418937 |
| high-contrast | mute | error-soft/panel | #9b9791 | 37.160000, 26.720000, 24.560000 | 155.000000, 151.000000, 145.000000 | 5.796668 |
| high-contrast | body | error-soft/panel | #c9c6bf | 37.160000, 26.720000, 24.560000 | 201.000000, 198.000000, 191.000000 | 9.873398 |
| high-contrast | text | error-soft/panel | #f1efe9 | 37.160000, 26.720000, 24.560000 | 241.000000, 239.000000, 233.000000 | 14.644288 |
| high-contrast | mute | error-soft/card | #9b9791 | 45.080000, 34.640000, 32.480000 | 155.000000, 151.000000, 145.000000 | 5.278650 |
| high-contrast | body | error-soft/card | #c9c6bf | 45.080000, 34.640000, 32.480000 | 201.000000, 198.000000, 191.000000 | 8.991063 |
| high-contrast | text | error-soft/card | #f1efe9 | 45.080000, 34.640000, 32.480000 | 241.000000, 239.000000, 233.000000 | 13.335604 |
| high-contrast | mute | error-soft/card2 | #9b9791 | 51.240000, 40.800000, 38.640000 | 155.000000, 151.000000, 145.000000 | 4.867349 |
| high-contrast | body | error-soft/card2 | #c9c6bf | 51.240000, 40.800000, 38.640000 | 201.000000, 198.000000, 191.000000 | 8.290499 |
| high-contrast | text | error-soft/card2 | #f1efe9 | 51.240000, 40.800000, 38.640000 | 241.000000, 239.000000, 233.000000 | 12.296523 |
| high-contrast | mute | focus-black | #9b9791 | 0.000000, 0.000000, 0.000000 | 155.000000, 151.000000, 145.000000 | 7.229223 |
| high-contrast | body | focus-black | #d8d4cc | 0.000000, 0.000000, 0.000000 | 216.000000, 212.000000, 204.000000 | 14.209106 |
| high-contrast | text | focus-black | #f1efe9 | 0.000000, 0.000000, 0.000000 | 241.000000, 239.000000, 233.000000 | 18.263394 |
| nebula | mute | bg | #a99598 | 2.000000, 1.000000, 2.000000 | 169.000000, 149.000000, 152.000000 | 7.381807 |
| nebula | body | bg | #f7f0f1 | 2.000000, 1.000000, 2.000000 | 247.000000, 240.000000, 241.000000 | 18.544406 |
| nebula | text | bg | #f7f0f1 | 2.000000, 1.000000, 2.000000 | 247.000000, 240.000000, 241.000000 | 18.544406 |
| nebula | mute | panel | #a99598 | 10.000000, 7.000000, 8.000000 | 169.000000, 149.000000, 152.000000 | 7.106758 |
| nebula | body | panel | #f7f0f1 | 10.000000, 7.000000, 8.000000 | 247.000000, 240.000000, 241.000000 | 17.853432 |
| nebula | text | panel | #f7f0f1 | 10.000000, 7.000000, 8.000000 | 247.000000, 240.000000, 241.000000 | 17.853432 |
| nebula | mute | card | #a99598 | 23.000000, 17.000000, 19.000000 | 169.000000, 149.000000, 152.000000 | 6.606825 |
| nebula | body | card | #f7f0f1 | 23.000000, 17.000000, 19.000000 | 247.000000, 240.000000, 241.000000 | 16.597512 |
| nebula | text | card | #f7f0f1 | 23.000000, 17.000000, 19.000000 | 247.000000, 240.000000, 241.000000 | 16.597512 |
| nebula | mute | card2 | #a99598 | 33.000000, 25.000000, 27.000000 | 169.000000, 149.000000, 152.000000 | 6.100127 |
| nebula | body | card2 | #f7f0f1 | 33.000000, 25.000000, 27.000000 | 247.000000, 240.000000, 241.000000 | 15.324598 |
| nebula | text | card2 | #f7f0f1 | 33.000000, 25.000000, 27.000000 | 247.000000, 240.000000, 241.000000 | 15.324598 |
| nebula | mute | ground | #a99598 | 5.000000, 3.000000, 4.000000 | 169.000000, 149.000000, 152.000000 | 7.284719 |
| nebula | body | ground | #f7f0f1 | 5.000000, 3.000000, 4.000000 | 247.000000, 240.000000, 241.000000 | 18.300502 |
| nebula | text | ground | #f7f0f1 | 5.000000, 3.000000, 4.000000 | 247.000000, 240.000000, 241.000000 | 18.300502 |
| nebula | mute | me | #a99598 | 33.000000, 25.000000, 27.000000 | 169.000000, 149.000000, 152.000000 | 6.100127 |
| nebula | body | me | #f7f0f1 | 33.000000, 25.000000, 27.000000 | 247.000000, 240.000000, 241.000000 | 15.324598 |
| nebula | text | me | #f7f0f1 | 33.000000, 25.000000, 27.000000 | 247.000000, 240.000000, 241.000000 | 15.324598 |
| nebula | mute | accent-soft/panel | #a99598 | 44.300000, 12.320000, 16.960000 | 169.000000, 149.000000, 152.000000 | 6.354907 |
| nebula | body | accent-soft/panel | #f7f0f1 | 44.300000, 12.320000, 16.960000 | 247.000000, 240.000000, 241.000000 | 15.964651 |
| nebula | text | accent-soft/panel | #f7f0f1 | 44.300000, 12.320000, 16.960000 | 247.000000, 240.000000, 241.000000 | 15.964651 |
| nebula | mute | accent-soft/card | #a99598 | 55.480000, 20.920000, 26.420000 | 169.000000, 149.000000, 152.000000 | 5.779762 |
| nebula | body | accent-soft/card | #f7f0f1 | 55.480000, 20.920000, 26.420000 | 247.000000, 240.000000, 241.000000 | 14.519785 |
| nebula | text | accent-soft/card | #f7f0f1 | 55.480000, 20.920000, 26.420000 | 247.000000, 240.000000, 241.000000 | 14.519785 |
| nebula | mute | accent-soft/card2 | #a99598 | 64.080000, 27.800000, 33.300000 | 169.000000, 149.000000, 152.000000 | 5.294767 |
| nebula | body | accent-soft/card2 | #f7f0f1 | 64.080000, 27.800000, 33.300000 | 247.000000, 240.000000, 241.000000 | 13.301391 |
| nebula | text | accent-soft/card2 | #f7f0f1 | 64.080000, 27.800000, 33.300000 | 247.000000, 240.000000, 241.000000 | 13.301391 |
| nebula | mute | waiting-soft/panel | #a99598 | 36.400000, 29.200000, 20.360000 | 169.000000, 149.000000, 152.000000 | 5.883101 |
| nebula | body | waiting-soft/panel | #f7f0f1 | 36.400000, 29.200000, 20.360000 | 247.000000, 240.000000, 241.000000 | 14.779391 |
| nebula | text | waiting-soft/panel | #f7f0f1 | 36.400000, 29.200000, 20.360000 | 247.000000, 240.000000, 241.000000 | 14.779391 |
| nebula | mute | waiting-soft/card | #a99598 | 47.840000, 38.000000, 30.040000 | 169.000000, 149.000000, 152.000000 | 5.235562 |
| nebula | body | waiting-soft/card | #f7f0f1 | 47.840000, 38.000000, 30.040000 | 247.000000, 240.000000, 241.000000 | 13.152658 |
| nebula | text | waiting-soft/card | #f7f0f1 | 47.840000, 38.000000, 30.040000 | 247.000000, 240.000000, 241.000000 | 13.152658 |
| nebula | mute | waiting-soft/card2 | #a99598 | 56.640000, 45.040000, 37.080000 | 169.000000, 149.000000, 152.000000 | 4.724488 |
| nebula | body | waiting-soft/card2 | #f7f0f1 | 56.640000, 45.040000, 37.080000 | 247.000000, 240.000000, 241.000000 | 11.868750 |
| nebula | text | waiting-soft/card2 | #f7f0f1 | 56.640000, 45.040000, 37.080000 | 247.000000, 240.000000, 241.000000 | 11.868750 |
| nebula | mute | ring-soft/panel | #a99598 | 36.600000, 10.500000, 15.000000 | 169.000000, 149.000000, 152.000000 | 6.585304 |
| nebula | body | ring-soft/panel | #f7f0f1 | 36.600000, 10.500000, 15.000000 | 247.000000, 240.000000, 241.000000 | 16.543448 |
| nebula | text | ring-soft/panel | #f7f0f1 | 36.600000, 10.500000, 15.000000 | 247.000000, 240.000000, 241.000000 | 16.543448 |
| nebula | mute | ring-soft/card | #a99598 | 47.780000, 19.100000, 24.460000 | 169.000000, 149.000000, 152.000000 | 6.038402 |
| nebula | body | ring-soft/card | #f7f0f1 | 47.780000, 19.100000, 24.460000 | 247.000000, 240.000000, 241.000000 | 15.169534 |
| nebula | text | ring-soft/card | #f7f0f1 | 47.780000, 19.100000, 24.460000 | 247.000000, 240.000000, 241.000000 | 15.169534 |
| nebula | mute | ring-soft/card2 | #a99598 | 56.380000, 25.980000, 31.340000 | 169.000000, 149.000000, 152.000000 | 5.559761 |
| nebula | body | ring-soft/card2 | #f7f0f1 | 56.380000, 25.980000, 31.340000 | 247.000000, 240.000000, 241.000000 | 13.967102 |
| nebula | text | ring-soft/card2 | #f7f0f1 | 56.380000, 25.980000, 31.340000 | 247.000000, 240.000000, 241.000000 | 13.967102 |
| nebula | mute | error-soft/panel | #a99598 | 36.280000, 23.200000, 21.920000 | 169.000000, 149.000000, 152.000000 | 6.139611 |
| nebula | body | error-soft/panel | #f7f0f1 | 36.280000, 23.200000, 21.920000 | 247.000000, 240.000000, 241.000000 | 15.423788 |
| nebula | text | error-soft/panel | #f7f0f1 | 36.280000, 23.200000, 21.920000 | 247.000000, 240.000000, 241.000000 | 15.423788 |
| nebula | mute | error-soft/card | #a99598 | 47.720000, 32.000000, 31.600000 | 169.000000, 149.000000, 152.000000 | 5.505157 |
| nebula | body | error-soft/card | #f7f0f1 | 47.720000, 32.000000, 31.600000 | 247.000000, 240.000000, 241.000000 | 13.829929 |
| nebula | text | error-soft/card | #f7f0f1 | 47.720000, 32.000000, 31.600000 | 247.000000, 240.000000, 241.000000 | 13.829929 |
| nebula | mute | error-soft/card2 | #a99598 | 56.520000, 39.040000, 38.640000 | 169.000000, 149.000000, 152.000000 | 4.990469 |
| nebula | body | error-soft/card2 | #f7f0f1 | 56.520000, 39.040000, 38.640000 | 247.000000, 240.000000, 241.000000 | 12.536941 |
| nebula | text | error-soft/card2 | #f7f0f1 | 56.520000, 39.040000, 38.640000 | 247.000000, 240.000000, 241.000000 | 12.536941 |
| nebula | mute | focus-black | #a99598 | 0.000000, 0.000000, 0.000000 | 169.000000, 149.000000, 152.000000 | 7.439381 |
| nebula | body | focus-black | #d8d4cc | 0.000000, 0.000000, 0.000000 | 216.000000, 212.000000, 204.000000 | 14.209106 |
| nebula | text | focus-black | #f1efe9 | 0.000000, 0.000000, 0.000000 | 241.000000, 239.000000, 233.000000 | 18.263394 |
| txmska | mute | bg | #a998c7 | 9.000000, 6.000000, 15.000000 | 169.000000, 152.000000, 199.000000 | 7.661578 |
| txmska | body | bg | #d4a8f5 | 9.000000, 6.000000, 15.000000 | 212.000000, 168.000000, 245.000000 | 10.261684 |
| txmska | text | bg | #f2e0ff | 9.000000, 6.000000, 15.000000 | 242.000000, 224.000000, 255.000000 | 16.161503 |
| txmska | mute | panel | #a998c7 | 17.000000, 8.000000, 30.000000 | 169.000000, 152.000000, 199.000000 | 7.428657 |
| txmska | body | panel | #d4a8f5 | 17.000000, 8.000000, 30.000000 | 212.000000, 168.000000, 245.000000 | 9.949716 |
| txmska | text | panel | #f2e0ff | 17.000000, 8.000000, 30.000000 | 242.000000, 224.000000, 255.000000 | 15.670174 |
| txmska | mute | card | #a998c7 | 28.000000, 17.000000, 56.000000 | 169.000000, 152.000000, 199.000000 | 6.744143 |
| txmska | body | card | #d4a8f5 | 28.000000, 17.000000, 56.000000 | 212.000000, 168.000000, 245.000000 | 9.032900 |
| txmska | text | card | #f2e0ff | 28.000000, 17.000000, 56.000000 | 242.000000, 224.000000, 255.000000 | 14.226246 |
| txmska | mute | card2 | #a998c7 | 32.000000, 26.000000, 82.000000 | 169.000000, 152.000000, 199.000000 | 6.012719 |
| txmska | body | card2 | #d4a8f5 | 32.000000, 26.000000, 82.000000 | 212.000000, 168.000000, 245.000000 | 8.053252 |
| txmska | text | card2 | #f2e0ff | 32.000000, 26.000000, 82.000000 | 242.000000, 224.000000, 255.000000 | 12.683362 |
| txmska | mute | ground | #a998c7 | 11.000000, 7.000000, 20.000000 | 169.000000, 152.000000, 199.000000 | 7.587781 |
| txmska | body | ground | #d4a8f5 | 11.000000, 7.000000, 20.000000 | 212.000000, 168.000000, 245.000000 | 10.162842 |
| txmska | text | ground | #f2e0ff | 11.000000, 7.000000, 20.000000 | 242.000000, 224.000000, 255.000000 | 16.005833 |
| txmska | mute | me | #a998c7 | 32.000000, 26.000000, 82.000000 | 169.000000, 152.000000, 199.000000 | 6.012719 |
| txmska | body | me | #d4a8f5 | 32.000000, 26.000000, 82.000000 | 212.000000, 168.000000, 245.000000 | 8.053252 |
| txmska | text | me | #f2e0ff | 32.000000, 26.000000, 82.000000 | 242.000000, 224.000000, 255.000000 | 12.683362 |
| txmska | mute | accent-soft/panel | #a998c7 | 44.180000, 21.860000, 69.060000 | 169.000000, 152.000000, 199.000000 | 6.120032 |
| txmska | body | accent-soft/panel | #d4a8f5 | 44.180000, 21.860000, 69.060000 | 212.000000, 168.000000, 245.000000 | 8.196984 |
| txmska | text | accent-soft/panel | #f2e0ff | 44.180000, 21.860000, 69.060000 | 242.000000, 224.000000, 255.000000 | 12.909732 |
| txmska | mute | accent-soft/card | #a998c7 | 53.200000, 29.240000, 90.380000 | 169.000000, 152.000000, 199.000000 | 5.409240 |
| txmska | body | accent-soft/card | #d4a8f5 | 53.200000, 29.240000, 90.380000 | 212.000000, 168.000000, 245.000000 | 7.244971 |
| txmska | text | accent-soft/card | #f2e0ff | 53.200000, 29.240000, 90.380000 | 242.000000, 224.000000, 255.000000 | 11.410372 |
| txmska | mute | accent-soft/card2 | #a998c7 | 56.480000, 36.620000, 111.700000 | 169.000000, 152.000000, 199.000000 | 4.810977 |
| txmska | body | accent-soft/card2 | #d4a8f5 | 56.480000, 36.620000, 111.700000 | 212.000000, 168.000000, 245.000000 | 6.443675 |
| txmska | text | accent-soft/card2 | #f2e0ff | 56.480000, 36.620000, 111.700000 | 242.000000, 224.000000, 255.000000 | 10.148381 |
| txmska | mute | waiting-soft/panel | #a998c7 | 42.560000, 30.080000, 39.720000 | 169.000000, 152.000000, 199.000000 | 6.073891 |
| txmska | body | waiting-soft/panel | #d4a8f5 | 42.560000, 30.080000, 39.720000 | 212.000000, 168.000000, 245.000000 | 8.135185 |
| txmska | text | waiting-soft/panel | #f2e0ff | 42.560000, 30.080000, 39.720000 | 242.000000, 224.000000, 255.000000 | 12.812401 |
| txmska | mute | waiting-soft/card | #a998c7 | 52.240000, 38.000000, 62.600000 | 169.000000, 152.000000, 199.000000 | 5.351675 |
| txmska | body | waiting-soft/card | #d4a8f5 | 52.240000, 38.000000, 62.600000 | 212.000000, 168.000000, 245.000000 | 7.167870 |
| txmska | text | waiting-soft/card | #f2e0ff | 52.240000, 38.000000, 62.600000 | 242.000000, 224.000000, 255.000000 | 11.288942 |
| txmska | mute | waiting-soft/card2 | #a998c7 | 55.760000, 45.920000, 85.480000 | 169.000000, 152.000000, 199.000000 | 4.738233 |
| txmska | body | waiting-soft/card2 | #d4a8f5 | 55.760000, 45.920000, 85.480000 | 212.000000, 168.000000, 245.000000 | 6.346245 |
| txmska | text | waiting-soft/card2 | #f2e0ff | 55.760000, 45.920000, 85.480000 | 242.000000, 224.000000, 255.000000 | 9.994935 |
| txmska | mute | ring-soft/panel | #a998c7 | 44.180000, 21.860000, 69.060000 | 169.000000, 152.000000, 199.000000 | 6.120032 |
| txmska | body | ring-soft/panel | #d4a8f5 | 44.180000, 21.860000, 69.060000 | 212.000000, 168.000000, 245.000000 | 8.196984 |
| txmska | text | ring-soft/panel | #f2e0ff | 44.180000, 21.860000, 69.060000 | 242.000000, 224.000000, 255.000000 | 12.909732 |
| txmska | mute | ring-soft/card | #a998c7 | 53.200000, 29.240000, 90.380000 | 169.000000, 152.000000, 199.000000 | 5.409240 |
| txmska | body | ring-soft/card | #d4a8f5 | 53.200000, 29.240000, 90.380000 | 212.000000, 168.000000, 245.000000 | 7.244971 |
| txmska | text | ring-soft/card | #f2e0ff | 53.200000, 29.240000, 90.380000 | 242.000000, 224.000000, 255.000000 | 11.410372 |
| txmska | mute | ring-soft/card2 | #a998c7 | 56.480000, 36.620000, 111.700000 | 169.000000, 152.000000, 199.000000 | 4.810977 |
| txmska | body | ring-soft/card2 | #d4a8f5 | 56.480000, 36.620000, 111.700000 | 212.000000, 168.000000, 245.000000 | 6.443675 |
| txmska | text | ring-soft/card2 | #f2e0ff | 56.480000, 36.620000, 111.700000 | 242.000000, 224.000000, 255.000000 | 10.148381 |
| txmska | mute | error-soft/panel | #a998c7 | 42.440000, 24.080000, 41.280000 | 169.000000, 152.000000, 199.000000 | 6.331290 |
| txmska | body | error-soft/panel | #d4a8f5 | 42.440000, 24.080000, 41.280000 | 212.000000, 168.000000, 245.000000 | 8.479937 |
| txmska | text | error-soft/panel | #f2e0ff | 42.440000, 24.080000, 41.280000 | 242.000000, 224.000000, 255.000000 | 13.355364 |
| txmska | mute | error-soft/card | #a998c7 | 52.120000, 32.000000, 64.160000 | 169.000000, 152.000000, 199.000000 | 5.605704 |
| txmska | body | error-soft/card | #d4a8f5 | 52.120000, 32.000000, 64.160000 | 212.000000, 168.000000, 245.000000 | 7.508109 |
| txmska | text | error-soft/card | #f2e0ff | 52.120000, 32.000000, 64.160000 | 242.000000, 224.000000, 255.000000 | 11.824797 |
| txmska | mute | error-soft/card2 | #a998c7 | 55.640000, 39.920000, 87.040000 | 169.000000, 152.000000, 199.000000 | 4.982329 |
| txmska | body | error-soft/card2 | #d4a8f5 | 55.640000, 39.920000, 87.040000 | 212.000000, 168.000000, 245.000000 | 6.673180 |
| txmska | text | error-soft/card2 | #f2e0ff | 55.640000, 39.920000, 87.040000 | 242.000000, 224.000000, 255.000000 | 10.509836 |
| txmska | mute | focus-black | #a998c7 | 0.000000, 0.000000, 0.000000 | 169.000000, 152.000000, 199.000000 | 8.003002 |
| txmska | body | focus-black | #d8d4cc | 0.000000, 0.000000, 0.000000 | 216.000000, 212.000000, 204.000000 | 14.209106 |
| txmska | text | focus-black | #f1efe9 | 0.000000, 0.000000, 0.000000 | 241.000000, 239.000000, 233.000000 | 18.263394 |
| coffee-cat | mute | bg | #e6e2ec | 44.000000, 28.000000, 64.000000 | 230.000000, 226.000000, 236.000000 | 12.213488 |
| coffee-cat | body | bg | rgba(247, 247, 247, 0.88) | 44.000000, 28.000000, 64.000000 | 222.640000, 220.720000, 225.040000 | 11.525053 |
| coffee-cat | text | bg | #f7f7f7 | 44.000000, 28.000000, 64.000000 | 247.000000, 247.000000, 247.000000 | 14.550024 |
| coffee-cat | mute | panel | #e6e2ec | 62.000000, 39.000000, 97.000000 | 230.000000, 226.000000, 236.000000 | 9.866813 |
| coffee-cat | body | panel | rgba(247, 247, 247, 0.88) | 62.000000, 39.000000, 97.000000 | 224.800000, 222.040000, 229.000000 | 9.461995 |
| coffee-cat | text | panel | #f7f7f7 | 62.000000, 39.000000, 97.000000 | 247.000000, 247.000000, 247.000000 | 11.754411 |
| coffee-cat | mute | card | #e6e2ec | 81.000000, 56.000000, 117.000000 | 230.000000, 226.000000, 236.000000 | 7.574259 |
| coffee-cat | body | card | rgba(247, 247, 247, 0.88) | 81.000000, 56.000000, 117.000000 | 227.080000, 224.080000, 231.400000 | 7.410251 |
| coffee-cat | text | card | #f7f7f7 | 81.000000, 56.000000, 117.000000 | 247.000000, 247.000000, 247.000000 | 9.023274 |
| coffee-cat | mute | card2 | #e6e2ec | 105.000000, 66.000000, 175.000000 | 230.000000, 226.000000, 236.000000 | 5.486679 |
| coffee-cat | body | card2 | rgba(247, 247, 247, 0.88) | 105.000000, 66.000000, 175.000000 | 229.960000, 225.280000, 238.360000 | 5.469388 |
| coffee-cat | text | card2 | #f7f7f7 | 105.000000, 66.000000, 175.000000 | 247.000000, 247.000000, 247.000000 | 6.536324 |
| coffee-cat | mute | ground | #e6e2ec | 38.000000, 24.000000, 58.000000 | 230.000000, 226.000000, 236.000000 | 12.913843 |
| coffee-cat | body | ground | rgba(247, 247, 247, 0.88) | 38.000000, 24.000000, 58.000000 | 221.920000, 220.240000, 224.320000 | 12.122235 |
| coffee-cat | text | ground | #f7f7f7 | 38.000000, 24.000000, 58.000000 | 247.000000, 247.000000, 247.000000 | 15.384363 |
| coffee-cat | mute | me | #e6e2ec | 105.000000, 66.000000, 175.000000 | 230.000000, 226.000000, 236.000000 | 5.486679 |
| coffee-cat | body | me | rgba(247, 247, 247, 0.88) | 105.000000, 66.000000, 175.000000 | 229.960000, 225.280000, 238.360000 | 5.469388 |
| coffee-cat | text | me | #f7f7f7 | 105.000000, 66.000000, 175.000000 | 247.000000, 247.000000, 247.000000 | 6.536324 |
| coffee-cat | mute | accent-soft/panel | #e6e2ec | 72.600000, 59.300000, 87.800000 | 230.000000, 226.000000, 236.000000 | 8.017900 |
| coffee-cat | body | accent-soft/panel | rgba(247, 247, 247, 0.88) | 72.600000, 59.300000, 87.800000 | 226.072000, 224.476000, 227.896000 | 7.829980 |
| coffee-cat | text | accent-soft/panel | #f7f7f7 | 72.600000, 59.300000, 87.800000 | 247.000000, 247.000000, 247.000000 | 9.551787 |
| coffee-cat | mute | accent-soft/card | #e6e2ec | 89.700000, 74.600000, 105.800000 | 230.000000, 226.000000, 236.000000 | 6.245416 |
| coffee-cat | body | accent-soft/card | rgba(247, 247, 247, 0.88) | 89.700000, 74.600000, 105.800000 | 228.124000, 226.312000, 230.056000 | 6.209077 |
| coffee-cat | text | accent-soft/card | #f7f7f7 | 89.700000, 74.600000, 105.800000 | 247.000000, 247.000000, 247.000000 | 7.440213 |
| coffee-cat | mute | accent-soft/card2 | #e6e2ec | 111.300000, 83.600000, 158.000000 | 230.000000, 226.000000, 236.000000 | 4.798212 |
| coffee-cat | body | accent-soft/card2 | rgba(247, 247, 247, 0.88) | 111.300000, 83.600000, 158.000000 | 230.716000, 227.392000, 236.320000 | 4.850554 |
| coffee-cat | text | accent-soft/card2 | #f7f7f7 | 111.300000, 83.600000, 158.000000 | 247.000000, 247.000000, 247.000000 | 5.716148 |
| coffee-cat | mute | waiting-soft/panel | #e6e2ec | 85.520000, 60.420000, 98.960000 | 230.000000, 226.000000, 236.000000 | 7.390763 |
| coffee-cat | body | waiting-soft/panel | rgba(247, 247, 247, 0.88) | 85.520000, 60.420000, 98.960000 | 227.622400, 224.610400, 229.235200 | 7.253386 |
| coffee-cat | text | waiting-soft/panel | #f7f7f7 | 85.520000, 60.420000, 98.960000 | 247.000000, 247.000000, 247.000000 | 8.804674 |
| coffee-cat | mute | waiting-soft/card | #e6e2ec | 101.860000, 75.040000, 116.160000 | 230.000000, 226.000000, 236.000000 | 5.827083 |
| coffee-cat | body | waiting-soft/card | rgba(247, 247, 247, 0.88) | 101.860000, 75.040000, 116.160000 | 229.583200, 226.364800, 231.299200 | 5.817171 |
| coffee-cat | text | waiting-soft/card | #f7f7f7 | 101.860000, 75.040000, 116.160000 | 247.000000, 247.000000, 247.000000 | 6.941850 |
| coffee-cat | mute | waiting-soft/card2 | #e6e2ec | 122.500000, 83.640000, 166.040000 | 230.000000, 226.000000, 236.000000 | 4.517026 |
| coffee-cat | body | waiting-soft/card2 | rgba(247, 247, 247, 0.88) | 122.500000, 83.640000, 166.040000 | 232.060000, 227.396800, 237.284800 | 4.581845 |
| coffee-cat | text | waiting-soft/card2 | #f7f7f7 | 122.500000, 83.640000, 166.040000 | 247.000000, 247.000000, 247.000000 | 5.381169 |
| coffee-cat | mute | ring-soft/panel | #e6e2ec | 72.600000, 59.300000, 87.800000 | 230.000000, 226.000000, 236.000000 | 8.017900 |
| coffee-cat | body | ring-soft/panel | rgba(247, 247, 247, 0.88) | 72.600000, 59.300000, 87.800000 | 226.072000, 224.476000, 227.896000 | 7.829980 |
| coffee-cat | text | ring-soft/panel | #f7f7f7 | 72.600000, 59.300000, 87.800000 | 247.000000, 247.000000, 247.000000 | 9.551787 |
| coffee-cat | mute | ring-soft/card | #e6e2ec | 89.700000, 74.600000, 105.800000 | 230.000000, 226.000000, 236.000000 | 6.245416 |
| coffee-cat | body | ring-soft/card | rgba(247, 247, 247, 0.88) | 89.700000, 74.600000, 105.800000 | 228.124000, 226.312000, 230.056000 | 6.209077 |
| coffee-cat | text | ring-soft/card | #f7f7f7 | 89.700000, 74.600000, 105.800000 | 247.000000, 247.000000, 247.000000 | 7.440213 |
| coffee-cat | mute | ring-soft/card2 | #e6e2ec | 111.300000, 83.600000, 158.000000 | 230.000000, 226.000000, 236.000000 | 4.798212 |
| coffee-cat | body | ring-soft/card2 | rgba(247, 247, 247, 0.88) | 111.300000, 83.600000, 158.000000 | 230.716000, 227.392000, 236.320000 | 4.850554 |
| coffee-cat | text | ring-soft/card2 | #f7f7f7 | 111.300000, 83.600000, 158.000000 | 247.000000, 247.000000, 247.000000 | 5.716148 |
| coffee-cat | mute | error-soft/panel | #e6e2ec | 82.040000, 51.360000, 100.240000 | 230.000000, 226.000000, 236.000000 | 8.129932 |
| coffee-cat | body | error-soft/panel | rgba(247, 247, 247, 0.88) | 82.040000, 51.360000, 100.240000 | 227.204800, 223.523200, 229.388800 | 7.915165 |
| coffee-cat | text | error-soft/panel | #f7f7f7 | 82.040000, 51.360000, 100.240000 | 247.000000, 247.000000, 247.000000 | 9.685252 |
| coffee-cat | mute | error-soft/card | #e6e2ec | 98.760000, 66.320000, 117.840000 | 230.000000, 226.000000, 236.000000 | 6.388912 |
| coffee-cat | body | error-soft/card | rgba(247, 247, 247, 0.88) | 98.760000, 66.320000, 117.840000 | 229.211200, 225.318400, 231.500800 | 6.330014 |
| coffee-cat | text | error-soft/card | #f7f7f7 | 98.760000, 66.320000, 117.840000 | 247.000000, 247.000000, 247.000000 | 7.611162 |
| coffee-cat | mute | error-soft/card2 | #e6e2ec | 119.880000, 75.120000, 168.880000 | 230.000000, 226.000000, 236.000000 | 4.870170 |
| coffee-cat | body | error-soft/card2 | rgba(247, 247, 247, 0.88) | 119.880000, 75.120000, 168.880000 | 231.745600, 226.374400, 237.625600 | 4.905039 |
| coffee-cat | text | error-soft/card2 | #f7f7f7 | 119.880000, 75.120000, 168.880000 | 247.000000, 247.000000, 247.000000 | 5.801872 |
| coffee-cat | mute | focus-black | #e6e2ec | 0.000000, 0.000000, 0.000000 | 230.000000, 226.000000, 236.000000 | 16.454367 |
| coffee-cat | body | focus-black | #d8d4cc | 0.000000, 0.000000, 0.000000 | 216.000000, 212.000000, 204.000000 | 14.209106 |
| coffee-cat | text | focus-black | #f1efe9 | 0.000000, 0.000000, 0.000000 | 241.000000, 239.000000, 233.000000 | 18.263394 |
| ntk | mute | bg | #b8afa4 | 16.000000, 14.000000, 12.000000 | 184.000000, 175.000000, 164.000000 | 8.903429 |
| ntk | body | bg | #cec5b9 | 16.000000, 14.000000, 12.000000 | 206.000000, 197.000000, 185.000000 | 11.293266 |
| ntk | text | bg | #f5f1ec | 16.000000, 14.000000, 12.000000 | 245.000000, 241.000000, 236.000000 | 17.131348 |
| ntk | mute | panel | #b8afa4 | 26.000000, 23.000000, 20.000000 | 184.000000, 175.000000, 164.000000 | 8.249424 |
| ntk | body | panel | #cec5b9 | 26.000000, 23.000000, 20.000000 | 206.000000, 197.000000, 185.000000 | 10.463714 |
| ntk | text | panel | #f5f1ec | 26.000000, 23.000000, 20.000000 | 245.000000, 241.000000, 236.000000 | 15.872957 |
| ntk | mute | card | #b8afa4 | 38.000000, 34.000000, 30.000000 | 184.000000, 175.000000, 164.000000 | 7.297991 |
| ntk | body | card | #cec5b9 | 38.000000, 34.000000, 30.000000 | 206.000000, 197.000000, 185.000000 | 9.256900 |
| ntk | text | card | #f5f1ec | 38.000000, 34.000000, 30.000000 | 245.000000, 241.000000, 236.000000 | 14.042278 |
| ntk | mute | card2 | #b8afa4 | 51.000000, 46.000000, 41.000000 | 184.000000, 175.000000, 164.000000 | 6.207635 |
| ntk | body | card2 | #cec5b9 | 51.000000, 46.000000, 41.000000 | 206.000000, 197.000000, 185.000000 | 7.873873 |
| ntk | text | card2 | #f5f1ec | 51.000000, 46.000000, 41.000000 | 245.000000, 241.000000, 236.000000 | 11.944292 |
| ntk | mute | ground | #b8afa4 | 19.000000, 17.000000, 14.000000 | 184.000000, 175.000000, 164.000000 | 8.711216 |
| ntk | body | ground | #cec5b9 | 19.000000, 17.000000, 14.000000 | 206.000000, 197.000000, 185.000000 | 11.049459 |
| ntk | text | ground | #f5f1ec | 19.000000, 17.000000, 14.000000 | 245.000000, 241.000000, 236.000000 | 16.761506 |
| ntk | mute | me | #b8afa4 | 51.000000, 46.000000, 41.000000 | 184.000000, 175.000000, 164.000000 | 6.207635 |
| ntk | body | me | #cec5b9 | 51.000000, 46.000000, 41.000000 | 206.000000, 197.000000, 185.000000 | 7.873873 |
| ntk | text | me | #f5f1ec | 51.000000, 46.000000, 41.000000 | 245.000000, 241.000000, 236.000000 | 11.944292 |
| ntk | mute | accent-soft/panel | #b8afa4 | 62.640000, 36.440000, 20.960000 | 184.000000, 175.000000, 164.000000 | 6.569296 |
| ntk | body | accent-soft/panel | #cec5b9 | 62.640000, 36.440000, 20.960000 | 206.000000, 197.000000, 185.000000 | 8.332610 |
| ntk | text | accent-soft/panel | #f5f1ec | 62.640000, 36.440000, 20.960000 | 245.000000, 241.000000, 236.000000 | 12.640175 |
| ntk | mute | accent-soft/card | #b8afa4 | 72.720000, 45.680000, 29.360000 | 184.000000, 175.000000, 164.000000 | 5.760218 |
| ntk | body | accent-soft/card | #cec5b9 | 72.720000, 45.680000, 29.360000 | 206.000000, 197.000000, 185.000000 | 7.306362 |
| ntk | text | accent-soft/card | #f5f1ec | 72.720000, 45.680000, 29.360000 | 245.000000, 241.000000, 236.000000 | 11.083404 |
| ntk | mute | accent-soft/card2 | #b8afa4 | 83.640000, 55.760000, 38.600000 | 184.000000, 175.000000, 164.000000 | 4.943413 |
| ntk | body | accent-soft/card2 | #cec5b9 | 83.640000, 55.760000, 38.600000 | 206.000000, 197.000000, 185.000000 | 6.270312 |
| ntk | text | accent-soft/card2 | #f5f1ec | 83.640000, 55.760000, 38.600000 | 245.000000, 241.000000, 236.000000 | 9.511766 |
| ntk | mute | waiting-soft/panel | #b8afa4 | 50.480000, 43.280000, 30.920000 | 184.000000, 175.000000, 164.000000 | 6.438927 |
| ntk | body | waiting-soft/panel | #cec5b9 | 50.480000, 43.280000, 30.920000 | 206.000000, 197.000000, 185.000000 | 8.167249 |
| ntk | text | waiting-soft/panel | #f5f1ec | 50.480000, 43.280000, 30.920000 | 245.000000, 241.000000, 236.000000 | 12.389329 |
| ntk | mute | waiting-soft/card | #b8afa4 | 61.040000, 52.960000, 39.720000 | 184.000000, 175.000000, 164.000000 | 5.586431 |
| ntk | body | waiting-soft/card | #cec5b9 | 61.040000, 52.960000, 39.720000 | 206.000000, 197.000000, 185.000000 | 7.085927 |
| ntk | text | waiting-soft/card | #f5f1ec | 61.040000, 52.960000, 39.720000 | 245.000000, 241.000000, 236.000000 | 10.749015 |
| ntk | mute | waiting-soft/card2 | #b8afa4 | 72.480000, 63.520000, 49.400000 | 184.000000, 175.000000, 164.000000 | 4.741973 |
| ntk | body | waiting-soft/card2 | #cec5b9 | 72.480000, 63.520000, 49.400000 | 206.000000, 197.000000, 185.000000 | 6.014802 |
| ntk | text | waiting-soft/card2 | #f5f1ec | 72.480000, 63.520000, 49.400000 | 245.000000, 241.000000, 236.000000 | 9.124169 |
| ntk | mute | ring-soft/panel | #b8afa4 | 62.640000, 36.440000, 20.960000 | 184.000000, 175.000000, 164.000000 | 6.569296 |
| ntk | body | ring-soft/panel | #cec5b9 | 62.640000, 36.440000, 20.960000 | 206.000000, 197.000000, 185.000000 | 8.332610 |
| ntk | text | ring-soft/panel | #f5f1ec | 62.640000, 36.440000, 20.960000 | 245.000000, 241.000000, 236.000000 | 12.640175 |
| ntk | mute | ring-soft/card | #b8afa4 | 72.720000, 45.680000, 29.360000 | 184.000000, 175.000000, 164.000000 | 5.760218 |
| ntk | body | ring-soft/card | #cec5b9 | 72.720000, 45.680000, 29.360000 | 206.000000, 197.000000, 185.000000 | 7.306362 |
| ntk | text | ring-soft/card | #f5f1ec | 72.720000, 45.680000, 29.360000 | 245.000000, 241.000000, 236.000000 | 11.083404 |
| ntk | mute | ring-soft/card2 | #b8afa4 | 83.640000, 55.760000, 38.600000 | 184.000000, 175.000000, 164.000000 | 4.943413 |
| ntk | body | ring-soft/card2 | #cec5b9 | 83.640000, 55.760000, 38.600000 | 206.000000, 197.000000, 185.000000 | 6.270312 |
| ntk | text | ring-soft/card2 | #f5f1ec | 83.640000, 55.760000, 38.600000 | 245.000000, 241.000000, 236.000000 | 9.511766 |
| ntk | mute | error-soft/panel | #b8afa4 | 50.360000, 37.280000, 32.480000 | 184.000000, 175.000000, 164.000000 | 6.801923 |
| ntk | body | error-soft/panel | #cec5b9 | 50.360000, 37.280000, 32.480000 | 206.000000, 197.000000, 185.000000 | 8.627679 |
| ntk | text | error-soft/panel | #f5f1ec | 50.360000, 37.280000, 32.480000 | 245.000000, 241.000000, 236.000000 | 13.087780 |
| ntk | mute | error-soft/card | #b8afa4 | 60.920000, 46.960000, 41.280000 | 184.000000, 175.000000, 164.000000 | 5.931785 |
| ntk | body | error-soft/card | #cec5b9 | 60.920000, 46.960000, 41.280000 | 206.000000, 197.000000, 185.000000 | 7.523980 |
| ntk | text | error-soft/card | #f5f1ec | 60.920000, 46.960000, 41.280000 | 245.000000, 241.000000, 236.000000 | 11.413521 |
| ntk | mute | error-soft/card2 | #b8afa4 | 72.360000, 57.520000, 50.960000 | 184.000000, 175.000000, 164.000000 | 5.050962 |
| ntk | body | error-soft/card2 | #cec5b9 | 72.360000, 57.520000, 50.960000 | 206.000000, 197.000000, 185.000000 | 6.406728 |
| ntk | text | error-soft/card2 | #f5f1ec | 72.360000, 57.520000, 50.960000 | 245.000000, 241.000000, 236.000000 | 9.718703 |
| ntk | mute | focus-black | #b8afa4 | 0.000000, 0.000000, 0.000000 | 184.000000, 175.000000, 164.000000 | 9.706125 |
| ntk | body | focus-black | #d8d4cc | 0.000000, 0.000000, 0.000000 | 216.000000, 212.000000, 204.000000 | 14.209106 |
| ntk | text | focus-black | #f1efe9 | 0.000000, 0.000000, 0.000000 | 241.000000, 239.000000, 233.000000 | 18.263394 |

### Non-text control contrast (3:1 floor)

The family ring and accent indicators are measured against panel and ground in all six looks. Each indicator meets the 3:1 non-text contrast floor. No bright or white border is used to meet the floor.

| Look | Indicator | Surface | Raw color | Background RGB | Indicator RGB | Ratio |
| --- | --- | --- | --- | --- | --- | --- |
| modern | ring | panel | #a48aaf | 24.000000, 18.000000, 29.000000 | 164.000000, 138.000000, 175.000000 | 5.977526 |
| modern | ring | ground | #a48aaf | 19.000000, 14.000000, 23.000000 | 164.000000, 138.000000, 175.000000 | 6.195544 |
| modern | accent | panel | #bdcd79 | 24.000000, 18.000000, 29.000000 | 189.000000, 205.000000, 121.000000 | 10.648555 |
| modern | accent | ground | #bdcd79 | 19.000000, 14.000000, 23.000000 | 189.000000, 205.000000, 121.000000 | 11.036940 |
| high-contrast | ring | panel | #d4b06a | 11.000000, 11.000000, 11.000000 | 212.000000, 176.000000, 106.000000 | 9.576690 |
| high-contrast | ring | ground | #d4b06a | 5.000000, 5.000000, 5.000000 | 212.000000, 176.000000, 106.000000 | 9.916667 |
| high-contrast | accent | panel | #d4b06a | 11.000000, 11.000000, 11.000000 | 212.000000, 176.000000, 106.000000 | 9.576690 |
| high-contrast | accent | ground | #d4b06a | 5.000000, 5.000000, 5.000000 | 212.000000, 176.000000, 106.000000 | 9.916667 |
| nebula | ring | panel | #c8203a | 10.000000, 7.000000, 8.000000 | 200.000000, 32.000000, 58.000000 | 3.557089 |
| nebula | ring | ground | #c8203a | 5.000000, 3.000000, 4.000000 | 200.000000, 32.000000, 58.000000 | 3.646162 |
| nebula | accent | panel | #ff2d48 | 10.000000, 7.000000, 8.000000 | 255.000000, 45.000000, 72.000000 | 5.465141 |
| nebula | accent | ground | #ff2d48 | 5.000000, 3.000000, 4.000000 | 255.000000, 45.000000, 72.000000 | 5.601994 |
| txmska | ring | panel | #a855f7 | 17.000000, 8.000000, 30.000000 | 168.000000, 85.000000, 247.000000 | 4.926551 |
| txmska | ring | ground | #a855f7 | 11.000000, 7.000000, 20.000000 | 168.000000, 85.000000, 247.000000 | 5.032079 |
| txmska | accent | panel | #a855f7 | 17.000000, 8.000000, 30.000000 | 168.000000, 85.000000, 247.000000 | 4.926551 |
| txmska | accent | ground | #a855f7 | 11.000000, 7.000000, 20.000000 | 168.000000, 85.000000, 247.000000 | 5.032079 |
| coffee-cat | ring | panel | #a8f205 | 62.000000, 39.000000, 97.000000 | 168.000000, 242.000000, 5.000000 | 9.215382 |
| coffee-cat | ring | ground | #a8f205 | 38.000000, 24.000000, 58.000000 | 168.000000, 242.000000, 5.000000 | 12.061240 |
| coffee-cat | accent | panel | #a8f205 | 62.000000, 39.000000, 97.000000 | 168.000000, 242.000000, 5.000000 | 9.215382 |
| coffee-cat | accent | ground | #a8f205 | 38.000000, 24.000000, 58.000000 | 168.000000, 242.000000, 5.000000 | 12.061240 |
| ntk | ring | panel | #ff6b1a | 26.000000, 23.000000, 20.000000 | 255.000000, 107.000000, 26.000000 | 6.263901 |
| ntk | ring | ground | #ff6b1a | 19.000000, 17.000000, 14.000000 | 255.000000, 107.000000, 26.000000 | 6.614546 |
| ntk | accent | panel | #ff6b1a | 26.000000, 23.000000, 20.000000 | 255.000000, 107.000000, 26.000000 | 6.263901 |
| ntk | accent | ground | #ff6b1a | 19.000000, 17.000000, 14.000000 | 255.000000, 107.000000, 26.000000 | 6.614546 |
### Target geometry and keyboard contracts

The following dimensions are CSS pixel boxes derived from the actual stylesheet, including global minimum inline/block size 32. They are not browser bounding-rectangle observations. Checkbox/radio label rows are the clickable hit area; the existing visible controls remain 18px. Blueprint corner handles preserve a 32px hit area and a 9px visible square.

| Selector/target | Width minimum | Height minimum | Visible part |
| --- | --- | --- | --- |
| button, role button, link, summary, select, textarea, editable text, text input | 32 | 32 | Control dependent |
| .icon-button | 36 | 36 | 16px icon |
| .board-tool, .board-swatch, .board-resize | 32 | 32 | Corner square 9x9 |
| .comment-send | 34 | 34 | Icon |
| .map-handle | 44 | 44 | 16px dot |
| .phone-code-cell | 40 | 50 | Six decorative cells, one input overlay |
| .phone-nav button and phone actions | 32 | 44 | Icon and label |
| .segmented .segment, .comment-preference-label, .settings-content-item, .settings-change label | 32 | 32 | Associated checkbox/radio hit area |

Node DOM-fixture checks exercise a focusable skip destination, one primary heading, named buttons, preserved Map/tab/Settings/phone control identity after redraw, arrow/Home/End Settings navigation, Escape menu closure, visible-enabled dialog Tab wrapping and a replaced invoker. Persistent polite/assertive live regions are atomic and unchanged outcomes do not write again. A pending action announces its label and initial elapsed wait once; elapsed repaint does not repeat it, and a later identical success is announced after the pending state. Rejected phone codes return focus to the field and expose one atomic alert; the pairing gate also has one heading and a skip destination. Grayscale distinctions retain filled working, thick-ring waiting and thin-ring idle; reduced motion disables animation/transition and restores automatic scrolling.

At narrow widths, Settings previews use auto-fit columns, tabs/actions wrap, QR columns stack and machine menus fit the viewport. At 360px or less the phone code cells wrap to three columns and the single input covers both rows. The phone gate scrolls and its dock reserves the bottom safe area. Existing virtual-list tests exercise End and the final mounted item in a constrained pane; actual 200% browser zoom and absence of clipping are still visual checks for T064.

Font evidence is tested through actual HTTP responses from both hosts, exact four-name allowlists, WOFF2 signatures and byte comparison against docs/flows/assets. Installer payload collection and an in-memory ZIP/manifest round trip verify font inclusion and hashes. No download, production installer launch or real configuration mutation is performed.

### Setup muted-text measurements

The setup uses its existing Modern palette with --muted #aa9fb1. Its .step-count, .folder-field labels, .offer-badge, .progress-time, .setup-note, .mode-dialog hints and .legacy-session metadata are checked on the four base surfaces and both existing soft-fill envelopes. These ten additional calculated pairs pass without a setup palette change.

| Look | Role | Surface/state | Raw foreground | Composited background RGB | Composited foreground RGB | Ratio |
| --- | --- | --- | --- | --- | --- | --- |
| setup | muted | bg | #aa9fb1 | 15.000000, 11.000000, 19.000000 | 170.000000, 159.000000, 177.000000 | 7.705506 |
| setup | muted | panel | #aa9fb1 | 24.000000, 18.000000, 29.000000 | 170.000000, 159.000000, 177.000000 | 7.263855 |
| setup | muted | card | #aa9fb1 | 33.000000, 26.000000, 39.000000 | 170.000000, 159.000000, 177.000000 | 6.686952 |
| setup | muted | card2 | #aa9fb1 | 43.000000, 34.000000, 50.000000 | 170.000000, 159.000000, 177.000000 | 6.027444 |
| setup | muted | waiting-soft/panel | #aa9fb1 | 48.720000, 38.880000, 38.840000 | 170.000000, 159.000000, 177.000000 | 5.738607 |
| setup | muted | waiting-soft/card | #aa9fb1 | 56.640000, 45.920000, 47.640000 | 170.000000, 159.000000, 177.000000 | 5.178254 |
| setup | muted | waiting-soft/card2 | #aa9fb1 | 65.440000, 52.960000, 57.320000 | 170.000000, 159.000000, 177.000000 | 4.623201 |
| setup | muted | error-soft/panel | #aa9fb1 | 48.600000, 32.880000, 40.400000 | 170.000000, 159.000000, 177.000000 | 6.034338 |
| setup | muted | error-soft/card | #aa9fb1 | 56.520000, 39.920000, 49.200000 | 170.000000, 159.000000, 177.000000 | 5.468866 |
| setup | muted | error-soft/card2 | #aa9fb1 | 65.320000, 46.960000, 58.880000 | 170.000000, 159.000000, 177.000000 | 4.896335 |

### Observed command results

`node --test test/gui-shell.test.mjs test/service-api.test.mjs test/interfaces-server.test.mjs test/service-install.test.mjs`: exit 0; 206 tests passed, 0 failed, 0 canceled, 0 skipped; 77555.252 ms. The process tree had a 180000 ms wall-clock limit and exited normally.

The changed-path search additionally selected final-look-options, final-named-control, final-palettes, final-status-shapes, gui-actions, gui-editors, gui-map, service-auth, service-editors, service-integration, service-settings and spanish-register, each under test/ with the .test.mjs suffix. `node --test` over those twelve files: exit 0; 212 passed, 0 failed, 0 canceled, 0 skipped; 86602.4721 ms, within the same 180000 ms limit. Together these two runs cover all sixteen importing/reading test files found for the changed modules and styles.

`npm.cmd run lint`: exit 0; 231 Markdown files inspected, 0 issues. `npm.cmd run build`: exit 0; hivem1nd@3.0.0, 360 packaged files, browser assets packaged, including the four exact font basenames. The temporary package output was restored to its pre-build bytes. `git diff --check`: exit 0, no whitespace errors. Test/build processes exited; no staging or commit was performed.

## T091 start workflow, 2026-10-15

Start 1.1 to 1.4 and start 2.1 to 2.6 have no new browser observations. This task was executed without opening a browser, Computer Use or screenshots, as requested. The earlier captures and measurements remain historical; the Overmind performs the visual comparison, including 1440x900, 720x600, 200% zoom and all six looks, during final verification.

The command tests exercise the mounted discovery offer against the actual core with an injected Git runner, explicit import and dismissal, retained filter/parent selections, Later, retained creation operations, empty clusters and stored agent choices. Separate actual-core tests use temporary Git repositories and a worktree to verify canonical import, unchanged repository bytes, bounded Git facts/changes, reviewed editor opening and guarded link removal/Undo. The injected native adapter verifies the stored external model/effort and immutable scope at launch; no real agent session is opened. DOM and geometry tests cover bilingual controls, connected-only choices, unknown quota, disabled Lyra modes, aliases, nested frames, full Fit, flight, pan, Shift-selection, keyboard focus and preserved drafts. These are command results and source contracts, not observed browser rectangles or native accessibility measurements.

`node --test test/gui-start.test.mjs test/gui-clusters.test.mjs test/gui-cluster-geometry.test.mjs test/gui-map.test.mjs test/gui-shell.test.mjs test/gui-fixture.test.mjs test/service-api.test.mjs`: exit 0; 204 passed, 0 failed, 0 canceled, 0 skipped; 82000.9215 ms, within a 180000 ms process-tree limit.

The changed-path import/read search selected 28 test files. The 22 additional files ran as `node --test test/final-group-bounds.test.mjs test/final-look-options.test.mjs test/final-palettes.test.mjs test/final-status-shapes.test.mjs test/final-unit-labels.test.mjs test/final-waiting-sections.test.mjs test/gui-actions.test.mjs test/gui-editors.test.mjs test/gui-transport.test.mjs test/service-additions.test.mjs test/service-auth.test.mjs test/service-context.test.mjs test/service-editors.test.mjs test/service-groups.test.mjs test/service-install.test.mjs test/service-integration.test.mjs test/service-launch-choice.test.mjs test/service-lyra.test.mjs test/service-plans.test.mjs test/service-run-messaging.test.mjs test/service-settings.test.mjs test/spanish-register.test.mjs`: exit 0; 344 passed, 0 failed, 0 canceled, 0 skipped; 94196.7597 ms, within a 240000 ms process-tree limit. Both test process trees exited normally. No browser observation, real native session, staging or commit was performed.

## T093 chat, plans, context and Work, 2026-10-15

Start 2.6 to 2.9, 3.1 to 3.2 and 4.1 to 4.2 have no new browser observations. As instructed, no browser, Computer Use or screenshot was opened. Board comparison, actual rectangles, keyboard behavior at 200% zoom and all six looks remain with the Overmind's final verification. No secret or raw transcript capture was recorded.

Mounted Node DOM tests use the actual HTTP service with temporary M1ND data, an injected native adapter and an injected clock. They observe the lead chat's revisioned plan, Run, task assignments, session bootstrap disclosure, separate Work milestones, preserved composer and authored messages, a real planning stall and its single Waiting pointer. A separate actual-core Overseer session observes live 18% and 82% context, generation-specific Close, Compact and Clear, preserving chat and the next draft. These are service/DOM observations, not visual browser acceptance.

The route matrix exercises successful owned regular-session and plan-session Work/transcript reads and phone denial, recording hit() for both boundaries. Additional tests cover legacy preload classification without historical-byte changes, shared message-copy deduplication, canonical recipient acknowledgments, warning control identities, lost-response Run replay, context estimates/unavailable states, keyboard tabs and retained Work pages. Native transcript persistence is asynchronous so it cannot delay the transport's turn acknowledgment.

The exact T093 Proof file set passed: 234 tests, 0 failed, 0 canceled, 0 skipped, exit 0, 82046.8283 ms, under a 240000 ms process-tree limit. A search of test/ for every changed source path and basename selected 61 importing/reading test files; together with the Proof, the final combined run covered 63 files and passed 1087 tests, 0 failed, 0 canceled, 0 skipped, exit 0, 159381.7899 ms, under a 360000 ms process-tree limit.

`npm.cmd run lint` passed with 231 Markdown files and 0 issues. `npm.cmd run build` passed with 390 packaged files and browser assets packaged. The package archive was restored to its pre-build bytes. No staging or commit was performed.

## T094 Add and canonical links, 2026-10-15

Flow 2.19 to 2.22 and 6.8, together with start 1.3, 1.4 and 2.2 to 2.6, have no new browser observations or captures. As instructed, this task used command tests only. Board geometry at 1440x900 and 720x600, all six looks, 200% zoom, reduced motion and native keyboard behavior remain for the Overmind's final visual verification. Historical browser results above are not evidence of this task's screens.

Mounted Node DOM tests observe one retained Add dialog from the shared bar and Content, both languages and six look settings, immediate Enter inspection, Back/Cancel/reopen, retained selection, field focus and caret. The actual HTTP core, temporary M1ND and injected archive transport observe zero-agent repository acceptance selecting its canonical cluster, no automatic agent/session, explicit Executor creation with stored Runs in, skill and knowledge placement, provenance/counts, explicit pinned update, preserved NOTICE and editor/preferences drafts, guarded Content Remove/Undo and Settings link removal/Undo retaining the same cluster and agent.

Controller tests observe 300 ms debounce, ordered 64 KiB chunks, the identical failed-chunk operation, no File.path access, traversal/collision/size rejection, accepted-preview reconciliation after response loss, expiry review and removal of stale scope choices. A polling deadline retains the original preview identity. Service tests observe descendant/direct deduplication, native content access rechecked after cluster edits, running-session rejection before detaching a repository and ten-second Undo with checkout bytes retained. The route matrix records successful repository acceptance/removal and phone rejection with hit(); HTTP tests serve all three Add modules through the static allowlist.

The exact T094 Proof command passed: 258 tests, 0 failed, 0 canceled, 0 skipped, exit 0, 91149.1116 ms, under a 240000 ms process-tree limit. The changed-path and basename search selected 47 importing/reading test files. Their union with the Proof contains 50 files; the final source passed all 957 tests with `node --test --test-concurrency=4`, 0 failed, 0 canceled, 0 skipped, exit 0, 185327.2258 ms, under a 360000 ms process-tree limit. Every test process tree exited normally.

An earlier unrestricted combined run recorded 955 passes and one failure in `every contract route has a success result and an authority or boundary failure`. The named case then passed alone, followed by the successful exact Proof and final 50-file run above. A lint attempt during concurrent tests encountered an ENOENT while a temporary fixture was being removed; lint was repeated after the test processes exited.

`npm.cmd run build` passed on the final source: hivem1nd@3.0.0, 391 packaged files, browser assets packaged. Its archive was restored to its pre-build bytes. No real native session, staging or commit was performed.

`npm.cmd run lint` passed after the tests exited: 231 Markdown files, 0 issues, exit 0. `git diff --check` passed without whitespace errors. The pre-existing integration-plan amendment was preserved.

## T063 automated-gate evidence, 2026-10-15

Commands ran separately at the repository root through `npm.cmd` on 15 October 2026. No production file was changed. `npm.cmd test` enumerated every `test/*.test.mjs` file, 133 files. `npm.cmd run test:core` enumerated the 115 of those files whose names do not start with `gui-`.

The first `npm.cmd test` exited 1. The reporter printed 1609 tests, 2 suites, 1607 passed, 1 failed, 0 cancelled, 1 skipped, 0 todo, and 267236.1279 ms. The failure was `T094 actual-core Add selects one repository cluster, creates only an explicitly chosen agent and manages Content and links` at `test/gui-shell.test.mjs:6093`, error `Content Undo did not restore it.` That test then passed alone: exit 0, 1 passed, 0 failed, 0 cancelled, 0 skipped, 7827.439 ms. The full suite was run again. The second run is the npm test result below.

`npm.cmd test`: exit 0. The reporter printed 1609 tests, 2 suites, 1608 passed, 0 failed, 0 cancelled, 1 skipped, 0 todo, and 273674.7413 ms. No failing test names. The skipped test is `the home scan tolerates a directory it cannot list`, reason: `This platform does not enforce directory permissions for the current process.` The second run passed the T094 test named above.

`npm.cmd run test:core`: exit 0. The reporter printed 1290 tests, 2 suites, 1289 passed, 0 failed, 0 cancelled, 1 skipped, 0 todo, and 241698.4488 ms. No failing test names. The skipped test is again `the home scan tolerates a directory it cannot list`, with the same platform reason.

`npm.cmd run lint`: exit 0. markdownlint-cli2 v0.23.3 inspected 231 Markdown files and reported 0 issues.

`npm.cmd run build`: exit 0. It printed `Built hivem1nd@3.0.0: dist/hivem1nd-3.0.0.tgz (391 files, 6 roles, 10 commands, 15 features). browser assets packaged.`

`git diff --check`: exit 0. Its standard output was empty. Its standard error printed `warning: in the working copy of 'docs/3.0/integration.md', LF will be replaced by CRLF the next time Git touches it`. That amendment stays unstaged.

## T064 final acceptance, 2026-10-15

Scope follows the 15 October T064 amendment and the execution instruction: command tests are the Proof for that run, which opened no browser, Computer Use or screenshot. The later per-reference handoff below records 191 saved PNGs and two unreached destinations. The Overmind owns visual acceptance of all 94 active states in English and Spanish and all 193 capture destinations; neither the saved files nor older browser results establish final acceptance.

Sources are docs/3.0/final.md decisions 1 to 25, docs/flows/boards/hivem1nd-3-flow.mjs (91 references), docs/flows/boards/hivem1nd-3-start.mjs (17 references, wins on disagreement), and the complete T064 GUI verification list in docs/3.0/integration.md. The inventory test compares their actual reference/screen IDs and all fourteen explicit replacement mappings, with 94 active states and 193 unique capture destinations.

Reproduction uses finalVerificationCases(), finalLookCaptures() and seedFinalRepositories() in test/gui-data.mjs, and createFinalCoreFixture() in test/gui-fixture.mjs. The latter composes production HTTP, authentication, journal recovery, sync and persistence in temporary M1ND/repository trees. restart() closes the service and creates a cold store without retaining project bindings, then authenticates a new viewer. External Git/source/native operations use injected transports, not real account credentials or real agent sessions.

The actual-core T064 tests verify both-language discovery consent, 26 canonical repositories and worktree folding; unchanged source/index bytes; empty dismissal, canonical agents, aliases and explicit recipient reads; one approved plan launch with stored model/effort, unlinked write-root denial, authored Chat versus Work, phone boundaries and report/exit/cleanup separation after restart; Blueprint and bilingual Void physical moves, History and guarded Undo; checked Content pins, scope deduplication, unaccepted updates, zero-agent repository acceptance and Remove/Undo across restarts.

The first exact Proof failed: 12 tests, 11 passed, 1 failed, 0 canceled, exit 1, 23442.2002 ms. The cross-project editor case failed with unsafe_path during cold journal recovery. engine/service/service.mjs now binds accepted owner-local cluster projects before replay in both startService and composeCore. engine/service/store.mjs runs that read-only binding callback under the existing recovery/local-change guard, preventing recursive replay. Project registration, catalog checks, revisions, no-link checks, confinement, receipts and crash handling remain enforced.

The intermediate Proof reached guarded Undo and exposed an invalid test sequence: creating the second document after the first move legitimately changed the shared catalog revision. The test now creates both documents before moving them and undoes the moves in reverse order; no Undo revision guard was weakened. test/service-native-bridge.test.mjs adds cold-store regression coverage for both service entry points, for committed moves and crashes after prepare, after the first rename and before receipt publication.

`node --test --test-timeout=120000 test/service-integration.test.mjs`: exit 0; 12 passed, 0 failed, 0 canceled, 0 skipped; 24568.2285 ms, under a 180000 ms process-tree limit.

`node --test --test-timeout=120000 test/service-native-bridge.test.mjs`: exit 0; 28 passed, 0 failed, 0 canceled, 0 skipped; 33531.3959 ms, under a 180000 ms process-tree limit.

Live native clients/Lyra, optional OS startup registration, cross-machine behavior and a physical QR scan remain platform release checks. Injected wire/protocol tests establish only the isolated behavior they exercise. Actual visual target rectangles, contrast on rendered surfaces, focus/keyboard/scroll behavior, 200% zoom and per-state bilingual copy remain pending for the Overmind; the earlier T062 calculated contrast/target contracts are not substituted for those observations.

### Per-reference handoff

Every row has a checked reference mapping. Result CAPTURED means the listed PNG was saved from the reached GUI state. Result UNREACHED means that language could not be reached, and the reason follows. Suite names below are files in test/ with the .test.mjs suffix, providing command coverage, not a visual pass. Every capture path is relative to the repository root; replaced states link to their active replacement destinations and require no obsolete capture.

The capture passes used Chrome/155.0.8059.79 on 15 October 2026. The saved set retains 127 PNGs from source 09585c5e14563f97aec5a6a2574b00d315ac0dbd, ten follow-up PNGs from source 1a278b2edc413abab4ba61655386cb14c073cd66 (1.8, 1.9, 7.1, 7.2 and 7.3 in both languages), and 54 recaptured PNGs from source f4c7c76ac5eea5e4cec53392678c1a78ba6816b7 (2.2, 2.3, 2.4, 2.5, 2.6, 2.15, 2.16, 2.17, 2.18, 3.1 through 3.11, 6.10, 6.12, start 1.3, start 3.1, start 3.2, start 4.1 and start 4.2, each in English and Spanish), as recorded in docs/3.0/verification/README.md. CAPTURED records file creation only; the required-state column remains the checklist and does not assert that every listed element or action was reached. Behavior and visual acceptance remain separate checks.

| Reference and board screen ID | Required state or replacement | Command sources | Capture record | Viewport | Capture paths |
| --- | --- | --- | --- | --- | --- |
| 1.1 Install; flow:setup-welcome | open setup without a configured M1ND. | setup, core-migration, final-legacy-copy, service-install, gui-shell | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/1.1-en-modern.png`, `docs/3.0/verification/1.1-es-modern.png` |
| 1.2 Where the M1ND lives; flow:setup-mind | continue with a detected 2.x tree. | setup, core-migration, final-legacy-copy, service-install, gui-shell | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/1.2-en-modern.png`, `docs/3.0/verification/1.2-es-modern.png` |
| 1.3 Join an existing M1ND; flow:setup-join | choose a populated 3.0 fixture folder. | setup, core-migration, final-legacy-copy, service-install, gui-shell | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/1.3-en-modern.png`, `docs/3.0/verification/1.3-es-modern.png` |
| 1.4 Close 2.x sessions; flow:setup-close-2x | continue migration with owned local sessions and an offline remote legacy session. | setup, core-migration, final-legacy-copy, service-install, gui-shell | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/1.4-en-modern.png`, `docs/3.0/verification/1.4-es-modern.png` |
| 1.5 Relay service; flow:setup-service | confirm migration. | setup, core-migration, final-legacy-copy, service-install, gui-shell | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/1.5-en-modern.png`, `docs/3.0/verification/1.5-es-modern.png` |
| 1.6 A step failed; flow:setup-failed | inject a service port conflict. | setup, core-migration, final-legacy-copy, service-install, gui-shell | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/1.6-en-modern.png`, `docs/3.0/verification/1.6-es-modern.png` |
| 1.7 Ready; flow:setup-done | finish startup. | setup, core-migration, final-legacy-copy, service-install, gui-shell | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/1.7-en-modern.png`, `docs/3.0/verification/1.7-es-modern.png` |
| 1.8 Opening; flow:setup-loading | delay the initial read. | setup, core-migration, final-legacy-copy, service-install, gui-shell | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/1.8-en-modern.png`, `docs/3.0/verification/1.8-es-modern.png` |
| 1.9 The M1ND cannot be read; flow:setup-load-failed | delay the folder read for 30 seconds. | setup, core-migration, final-legacy-copy, service-install, gui-shell | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/1.9-en-modern.png`, `docs/3.0/verification/1.9-es-modern.png` |
| 1.10 Empty M1ND; flow:setup-empty | after setup, dismiss repository import and choose Later at Overseer creation. | setup, core-migration, final-legacy-copy, service-install, gui-shell | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/1.10-en-modern.png`, `docs/3.0/verification/1.10-es-modern.png` |
| 2.1 The Map; flow:map-idle | open accepted migrated data. | gui-shell, service-clusters, service-sessions, service-units-removal | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/2.1-en-modern.png`, `docs/3.0/verification/2.1-es-modern.png` |
| 2.2 A unit selected; flow:map-selected | click executor-shop. | gui-shell, service-clusters, service-sessions, service-units-removal | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/2.2-en-modern.png`, `docs/3.0/verification/2.2-es-modern.png` |
| 2.3 Rename; flow:map-rename | select executor-blog, then use F 2 or More/Rename. | gui-shell, service-clusters, service-sessions, service-units-removal | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/2.3-en-modern.png`, `docs/3.0/verification/2.3-es-modern.png` |
| 2.4 Renamed; flow:map-renamed | save Blog. | gui-shell, service-clusters, service-sessions, service-units-removal | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/2.4-en-modern.png`, `docs/3.0/verification/2.4-es-modern.png` |
| 2.5 Connect; flow:map-connect | drag overlord-web onto executor-site. | gui-shell, service-clusters, service-sessions, service-units-removal | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/2.5-en-modern.png`, `docs/3.0/verification/2.5-es-modern.png` |
| 2.6 Connected; flow:map-connect-saving | confirm the connection while delaying persistence. | gui-shell, service-clusters, service-sessions, service-units-removal | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/2.6-en-modern.png`, `docs/3.0/verification/2.6-es-modern.png` |
| 2.7 A selection; flow:map-selection | REPLACED by start 1.3/start 2.1/start 2.6; preserve Shift selection, alias identity, bulk messaging and explicit reporting changes, but use one cluster grouping and no Save as group surface. | gui-shell, service-clusters, service-sessions, service-units-removal | REPLACED; linked destinations CAPTURED | 1440x900 | `docs/3.0/verification/start-1.3-en-modern.png`, `docs/3.0/verification/start-1.3-es-modern.png`, `docs/3.0/verification/start-2.1-en-modern.png`, `docs/3.0/verification/start-2.1-es-modern.png`, `docs/3.0/verification/start-2.6-en-modern.png`, `docs/3.0/verification/start-2.6-es-modern.png` |
| 2.8 New group; flow:map-new-group | REPLACED by start 2.1; New cluster with repository/folder/nothing replaces the personal-group form. | gui-shell, service-clusters, service-sessions, service-units-removal | REPLACED; linked destinations CAPTURED | 1440x900 | `docs/3.0/verification/start-2.1-en-modern.png`, `docs/3.0/verification/start-2.1-es-modern.png` |
| 2.9 A group; flow:map-group | REPLACED by start 2.6 and start 2.7; one canonical cluster frame/tree/chat replaces independent personal groups. | gui-shell, service-clusters, service-sessions, service-units-removal | REPLACED; linked destinations CAPTURED | 1440x900 | `docs/3.0/verification/start-2.6-en-modern.png`, `docs/3.0/verification/start-2.6-es-modern.png`, `docs/3.0/verification/start-2.7-en-modern.png`, `docs/3.0/verification/start-2.7-es-modern.png` |
| 2.10 Delete a group; flow:map-delete-group | REPLACED by start 2.2; More cluster deletion retains confirmation, archive/history/unchanged agents/leads/files and ten-second Undo. | gui-shell, service-clusters, service-sessions, service-units-removal | REPLACED; linked destinations CAPTURED | 1440x900 | `docs/3.0/verification/start-2.2-en-modern.png`, `docs/3.0/verification/start-2.2-es-modern.png` |
| 2.11 New unit; flow:map-new-unit | REPLACED by start 2.3; New agent asks role and Runs in, deriving name/cluster/machine/lead. | gui-shell, service-clusters, service-sessions, service-units-removal | REPLACED; linked destinations CAPTURED | 1440x900 | `docs/3.0/verification/start-2.3-en-modern.png`, `docs/3.0/verification/start-2.3-es-modern.png` |
| 2.12 Creating; flow:map-creating | REPLACED by start 2.3 creation busy/failure variants; retain exact draft and receipt while the two-choice form is pending. | gui-shell, service-clusters, service-sessions, service-units-removal | REPLACED; linked destinations CAPTURED | 1440x900 | `docs/3.0/verification/start-2.3-en-modern.png`, `docs/3.0/verification/start-2.3-es-modern.png` |
| 2.13 Created; flow:map-created | REPLACED by start 2.6; created agents have actual derived identity/Runs in and no session until explicitly started. | gui-shell, service-clusters, service-sessions, service-units-removal | REPLACED; linked destinations CAPTURED | 1440x900 | `docs/3.0/verification/start-2.6-en-modern.png`, `docs/3.0/verification/start-2.6-es-modern.png` |
| 2.14 Start a session; flow:map-start-session | REPLACED by start 2.4/start 2.5; stored Runs in replaces client-only launch choice, with explicit task/chat intent retained. | gui-shell, service-clusters, service-sessions, service-units-removal | REPLACED; linked destinations CAPTURED for start 2.4; UNREACHED start 2.5 en/es: Lyra is not in the Runs in picker: the local service reports lyra_offline, so there is no connected Lyra model to select. | 1440x900 | `docs/3.0/verification/start-2.4-en-modern.png`, `docs/3.0/verification/start-2.4-es-modern.png` |
| 2.15 Starting; flow:map-starting | delay the start result. | gui-shell, service-clusters, service-sessions, service-units-removal | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/2.15-en-modern.png`, `docs/3.0/verification/2.15-es-modern.png` |
| 2.16 It did not start; flow:map-start-failed | inject a verified start failure after 30 seconds. | gui-shell, service-clusters, service-sessions, service-units-removal | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/2.16-en-modern.png`, `docs/3.0/verification/2.16-es-modern.png` |
| 2.17 Stop a session; flow:map-stop | choose Stop for a live unit. | gui-shell, service-clusters, service-sessions, service-units-removal | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/2.17-en-modern.png`, `docs/3.0/verification/2.17-es-modern.png` |
| 2.18 Remove a unit; flow:map-remove-unit | choose More/Remove for executor-mobile. | gui-shell, service-clusters, service-sessions, service-units-removal | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/2.18-en-modern.png`, `docs/3.0/verification/2.18-es-modern.png` |
| 2.19 Add to M1ND; flow:map-add | press + Add in the Map bar, or Content/Add. | gui-shell, gui-add-controller, service-additions | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/2.19-en-modern.png`, `docs/3.0/verification/2.19-es-modern.png` |
| 2.20 Check and who uses it; flow:map-add-check | select only pdf and press Continue. | gui-shell, gui-add-controller, service-additions | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/2.20-en-modern.png`, `docs/3.0/verification/2.20-es-modern.png` |
| 2.21 A skill in Content; flow:map-add-skill | confirm the eligible pdf check for the selected group and adjutant. | gui-shell, gui-add-controller, service-additions | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/2.21-en-modern.png`, `docs/3.0/verification/2.21-es-modern.png` |
| 2.22 A repository on the Map; flow:map-add-repo | accept a checked repository through Add. | gui-shell, gui-add-controller, service-additions | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/2.22-en-modern.png`, `docs/3.0/verification/2.22-es-modern.png` |
| 3.1 A chat; flow:chat-chat | select Chats, then the pinned executor conversation. | gui-shell, gui-chats, service-messaging, service-approvals, service-tasks | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/3.1-en-modern.png`, `docs/3.0/verification/3.1-es-modern.png` |
| 3.2 Sending; flow:chat-sending | submit a message while its POST is pending. | gui-shell, gui-chats, service-messaging, service-approvals, service-tasks | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/3.2-en-modern.png`, `docs/3.0/verification/3.2-es-modern.png` |
| 3.3 The agent is working; flow:chat-working | retain authored Delivered/Read chat while Work shows its actual elapsed native step and Stop the step. | gui-shell, gui-chats, service-messaging, service-approvals, service-tasks | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/3.3-en-modern.png`, `docs/3.0/verification/3.3-es-modern.png` |
| 3.4 Asks to open a session; flow:chat-open-cli | request a child command line from an Executor chat. | gui-shell, gui-chats, service-messaging, service-approvals, service-tasks | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/3.4-en-modern.png`, `docs/3.0/verification/3.4-es-modern.png` |
| 3.5 The reply; flow:chat-reply | record the recipient's explicit read and reply. | gui-shell, gui-chats, service-messaging, service-approvals, service-tasks | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/3.5-en-modern.png`, `docs/3.0/verification/3.5-es-modern.png` |
| 3.6 Not confirmed; flow:chat-failed | lose a send acknowledgment for 10 seconds. | gui-shell, gui-chats, service-messaging, service-approvals, service-tasks | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/3.6-en-modern.png`, `docs/3.0/verification/3.6-es-modern.png` |
| 3.7 Offline messages; flow:chat-mailbox | open an agent without a live session and one manual-app agent on offline LAPTOP. | gui-shell, gui-chats, service-messaging, service-approvals, service-tasks | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/3.7-en-modern.png`, `docs/3.0/verification/3.7-es-modern.png` |
| 3.8 Waiting on you; flow:chat-waiting | press the Waiting pill. | gui-shell, gui-chats, service-messaging, service-approvals, service-tasks | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/3.8-en-modern.png`, `docs/3.0/verification/3.8-es-modern.png` |
| 3.9 Answer sent; flow:chat-approval-sent | approve an ask while delaying its owner's acknowledgment. | gui-shell, gui-chats, service-messaging, service-approvals, service-tasks | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/3.9-en-modern.png`, `docs/3.0/verification/3.9-es-modern.png` |
| 3.10 Send back; flow:chat-send-back | choose Send back on a review. | gui-shell, gui-chats, service-messaging, service-approvals, service-tasks | CAPTURED PNG en/es, modern; required Send back dialog not reached: the driver fills an inline note only. Recaptured. | 1440x900 | `docs/3.0/verification/3.10-en-modern.png`, `docs/3.0/verification/3.10-es-modern.png` |
| 3.11 Accepted; flow:chat-accepted | accept a reviewable delivery. | gui-shell, gui-chats, service-messaging, service-approvals, service-tasks | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/3.11-en-modern.png`, `docs/3.0/verification/3.11-es-modern.png` |
| 3.12 A group's chat; flow:chat-group-chat | REPLACED by start 2.6/start 2.7; select the migrated cluster and reach its lead's persistent chat and Start a plan, never a second personal-group surface. | gui-shell, gui-chats, service-messaging, service-approvals, service-tasks | REPLACED; linked destinations CAPTURED | 1440x900 | `docs/3.0/verification/start-2.6-en-modern.png`, `docs/3.0/verification/start-2.6-es-modern.png`, `docs/3.0/verification/start-2.7-en-modern.png`, `docs/3.0/verification/start-2.7-es-modern.png` |
| 3.13 Start a plan; flow:chat-start-run | REPLACED by start 2.7; choose/review the real plan and assignments in the lead's chat, with new drafts approved before build and exact branch/commit consent. | gui-shell, gui-chats, service-messaging, service-approvals, service-tasks | REPLACED; linked destinations CAPTURED | 1440x900 | `docs/3.0/verification/start-2.7-en-modern.png`, `docs/3.0/verification/start-2.7-es-modern.png` |
| 3.14 A plan in progress; flow:chat-run-progress | REPLACED by start 2.8/start 4.2; the same chat card and separate Work show genuine task/step/elapsed state and the lead's authored summary. | gui-shell, gui-chats, service-messaging, service-approvals, service-tasks | REPLACED; linked destinations CAPTURED | 1440x900 | `docs/3.0/verification/start-2.8-en-modern.png`, `docs/3.0/verification/start-2.8-es-modern.png`, `docs/3.0/verification/start-4.2-en-modern.png`, `docs/3.0/verification/start-4.2-es-modern.png` |
| 3.15 A plan needs you; flow:chat-run-problem | REPLACED by start 2.9; the same warning card/Waiting handles no-start, stalled/unread work, Stop/Retry, escalation and budget extensions. | gui-shell, gui-chats, service-messaging, service-approvals, service-tasks | REPLACED; linked destinations CAPTURED | 1440x900 | `docs/3.0/verification/start-2.9-en-modern.png`, `docs/3.0/verification/start-2.9-es-modern.png` |
| 4.1 A board; flow:blueprint-board | open Blueprint and select an editable board without attachments. | gui-shell, gui-editors, service-editors, service-integration | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/4.1-en-modern.png`, `docs/3.0/verification/4.1-es-modern.png` |
| 4.2 Board menu; flow:blueprint-library | open an item's More control. | gui-shell, gui-editors, service-editors, service-integration | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/4.2-en-modern.png`, `docs/3.0/verification/4.2-es-modern.png` |
| 4.3 New board; flow:blueprint-new-board | press New board. | gui-shell, gui-editors, service-editors, service-integration | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/4.3-en-modern.png`, `docs/3.0/verification/4.3-es-modern.png` |
| 4.4 Search and filters; flow:blueprint-search | search cart, enable Open comments, open Filters. | gui-shell, gui-editors, service-editors, service-integration | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/4.4-en-modern.png`, `docs/3.0/verification/4.4-es-modern.png` |
| 4.5 Move to another project; flow:blueprint-move | choose Move to folder with destination api. | gui-shell, gui-editors, service-editors, service-integration | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/4.5-en-modern.png`, `docs/3.0/verification/4.5-es-modern.png` |
| 4.6 Delete a board; flow:blueprint-delete | choose Delete. | gui-shell, gui-editors, service-editors, service-integration | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/4.6-en-modern.png`, `docs/3.0/verification/4.6-es-modern.png` |
| 4.7 Edit the board; flow:blueprint-edit | select the sample button. | gui-shell, gui-editors, service-editors, service-integration | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/4.7-en-modern.png`, `docs/3.0/verification/4.7-es-modern.png` |
| 4.8 Sketch by hand; flow:blueprint-sketch | choose Draw and draw beside a screen. | gui-shell, gui-editors, service-editors, service-integration | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/4.8-en-modern.png`, `docs/3.0/verification/4.8-es-modern.png` |
| 4.9 Attach agents; flow:blueprint-attach | press Attach agents. 300-pixel picker; Search units and groups; checkbox/icon/name rows for individual units and group; current selection and Attach count; Cancel/Attach 2 in the sample. | gui-shell, gui-editors, service-editors, service-integration | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/4.9-en-modern.png`, `docs/3.0/verification/4.9-es-modern.png` |
| 4.10 Comment; flow:blueprint-comment | select an element and press C. | gui-shell, gui-editors, service-editors, service-integration | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/4.10-en-modern.png`, `docs/3.0/verification/4.10-es-modern.png` |
| 4.11 Comment sent; flow:blueprint-comment-sent | submit. | gui-shell, gui-editors, service-editors, service-integration | CAPTURED PNG en/es, modern; comment and pin reached, required recipient live Work row absent (E1). | 1440x900 | `docs/3.0/verification/4.11-en-modern.png`, `docs/3.0/verification/4.11-es-modern.png` |
| 4.12 Watch; flow:blueprint-watch | enable Watch and make an attached unit commit a drawing. | gui-shell, gui-editors, service-editors, service-integration | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/4.12-en-modern.png`, `docs/3.0/verification/4.12-es-modern.png` |
| 4.13 Changed while editing; flow:blueprint-conflict | retain local edit, receive an overlapping agent change and turn Send to agent off. | gui-shell, gui-editors, service-editors, service-integration | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/4.13-en-modern.png`, `docs/3.0/verification/4.13-es-modern.png` |
| 4.14 History; flow:blueprint-history | open History after creation, comment, agent drawing and conflict resolution. | gui-shell, gui-editors, service-editors, service-integration | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/4.14-en-modern.png`, `docs/3.0/verification/4.14-es-modern.png` |
| 5.1 Document; flow:void-document | open Void/select text. | gui-shell, gui-editors, service-editors, final-caret-map, final-find-matches | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/5.1-en-modern.png`, `docs/3.0/verification/5.1-es-modern.png` |
| 5.2 Rename and folders; flow:void-library | begin inline text rename and create a folder. | gui-shell, gui-editors, service-editors, final-caret-map, final-find-matches | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/5.2-en-modern.png`, `docs/3.0/verification/5.2-es-modern.png` |
| 5.3 Delete a text; flow:void-delete | delete a text or populated folder. | gui-shell, gui-editors, service-editors, final-caret-map, final-find-matches | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/5.3-en-modern.png`, `docs/3.0/verification/5.3-es-modern.png` |
| 5.4 Editing; flow:void-edit | select a passage and type in Document. | gui-shell, gui-editors, service-editors, final-caret-map, final-find-matches | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/5.4-en-modern.png`, `docs/3.0/verification/5.4-es-modern.png` |
| 5.5 Not saved; flow:void-not-saved | make the M1ND/repository unavailable during save. | gui-shell, gui-editors, service-editors, final-caret-map, final-find-matches | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/5.5-en-modern.png`, `docs/3.0/verification/5.5-es-modern.png` |
| 5.6 Find and replace; flow:void-find | open Find. | gui-shell, gui-editors, service-editors, final-caret-map, final-find-matches | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/5.6-en-modern.png`, `docs/3.0/verification/5.6-es-modern.png` |
| 5.7 Source; flow:void-source | toggle Source with caret in edited content. | gui-shell, gui-editors, service-editors, final-caret-map, final-find-matches | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/5.7-en-modern.png`, `docs/3.0/verification/5.7-es-modern.png` |
| 5.8 A suggested change; flow:void-suggestion | receive a current proposal. | gui-shell, gui-editors, service-editors, final-caret-map, final-find-matches | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/5.8-en-modern.png`, `docs/3.0/verification/5.8-es-modern.png` |
| 5.9 An old suggestion; flow:void-stale | change the proposal's base passage before accept. | gui-shell, gui-editors, service-editors, final-caret-map, final-find-matches | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/5.9-en-modern.png`, `docs/3.0/verification/5.9-es-modern.png` |
| 5.10 Focus; flow:void-focus | enter Focus. | gui-shell, gui-editors, service-editors, final-caret-map, final-find-matches | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/5.10-en-modern.png`, `docs/3.0/verification/5.10-es-modern.png` |
| 5.11 Focus, tools shown; flow:void-focus-tools | move pointer in Focus. | gui-shell, gui-editors, service-editors, final-caret-map, final-find-matches | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/5.11-en-modern.png`, `docs/3.0/verification/5.11-es-modern.png` |
| 6.1 Settings; flow:settings-settings | press gear. | gui-shell, service-settings, service-lifecycle, service-qr | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/6.1-en-modern.png`, `docs/3.0/verification/6.1-es-modern.png` |
| 6.2 Agents; flow:settings-agents | select Agents. | gui-shell, service-settings, service-lifecycle, service-qr | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/6.2-en-modern.png`, `docs/3.0/verification/6.2-es-modern.png` |
| 6.3 Connect an agent; flow:settings-connect | press Review changes for sample Cursor CLI. 600-pixel dialog; Connect the Cursor CLI; no-write-before-Apply/Copy explanation; checked Relay server/mcp.json and hooks/hooks.json changes; Optional permission; unchecked scoped git commit/git push/cli-config.json change; explicit-request note; kept-copy/Disconnect note; restart note; Cancel/Copy changes/Apply 2 changes. | gui-shell, service-settings, service-lifecycle, service-qr | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/6.3-en-modern.png`, `docs/3.0/verification/6.3-es-modern.png` |
| 6.4 Another machine; flow:settings-machine | open picker. 320-pixel menu/current machine/check; second machine/laptop/offline-since/latest-report-read-only explanation. | gui-shell, service-settings, service-lifecycle, service-qr | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/6.4-en-modern.png`, `docs/3.0/verification/6.4-es-modern.png` |
| 6.5 Permissions; flow:settings-permissions | select Permissions. | gui-shell, service-settings, service-lifecycle, service-qr | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/6.5-en-modern.png`, `docs/3.0/verification/6.5-es-modern.png` |
| 6.6 Projects; flow:settings-projects | REPLACED by start 2.1/start 2.2; Settings Projects lists canonical cluster links and selected-owner availability, without root/environment auto-import controls. | gui-shell, service-settings, service-lifecycle, service-qr | REPLACED; linked destinations CAPTURED | 1440x900 | `docs/3.0/verification/start-2.1-en-modern.png`, `docs/3.0/verification/start-2.1-es-modern.png`, `docs/3.0/verification/start-2.2-en-modern.png`, `docs/3.0/verification/start-2.2-es-modern.png` |
| 6.7 Remove a repository; flow:settings-remove-repo | REPLACED by start 2.2 link-removal variant; explicit detach preserves cluster/chat/agents/repository bytes and offers guarded Undo. | gui-shell, service-settings, service-lifecycle, service-qr | REPLACED; linked destinations CAPTURED | 1440x900 | `docs/3.0/verification/start-2.2-en-modern.png`, `docs/3.0/verification/start-2.2-es-modern.png` |
| 6.8 Content; flow:settings-content | select Content. | gui-shell, service-settings, service-lifecycle, service-qr | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/6.8-en-modern.png`, `docs/3.0/verification/6.8-es-modern.png` |
| 6.9 Open on the phone; flow:settings-home | press Open on the phone. 600-pixel dialog/title/same-network instruction; real black/white QR with quiet zone; Or type this code with generated six characters masked in captures; At/actual LAN origin; expiry; replacement/sign-out note; Close access/Done. | gui-shell, service-settings, service-lifecycle, service-qr | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/6.9-en-modern.png`, `docs/3.0/verification/6.9-es-modern.png` |
| 6.10 Reconnecting; flow:settings-reconnecting | interrupt response while composing/sending. | gui-shell, service-settings, service-lifecycle, service-qr | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/6.10-en-modern.png`, `docs/3.0/verification/6.10-es-modern.png` |
| 6.11 Service stopped; flow:settings-service-down | stop the owned fixture runtime. | gui-shell, service-settings, service-lifecycle, service-qr | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/6.11-en-modern.png`, `docs/3.0/verification/6.11-es-modern.png` |
| 6.12 Taking longer; flow:settings-slow | delay a non-send request for 12 seconds. | gui-shell, service-settings, service-lifecycle, service-qr | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/6.12-en-modern.png`, `docs/3.0/verification/6.12-es-modern.png` |
| 7.1 Pair; flow:phone-pair | open LAN shell without credential and enter code. 390 × 844; 44-pixel status/brand; mark 56; Open your M1ND; computer Settings/Open on the phone instruction; six 40 × 50 cells, gap 8, radius 12; filled accent/empty quiet lines; QR-camera note; Opening spinner during exchange. | gui-shell, service-home-lock, service-phone-approval, service-home-stream | CAPTURED en/es, modern | 390x844 | `docs/3.0/verification/7.1-en-modern.png`, `docs/3.0/verification/7.1-es-modern.png` |
| 7.2 Wrong code; flow:phone-pair-error | submit one wrong code. | gui-shell, service-home-lock, service-phone-approval, service-home-stream | CAPTURED en/es, modern | 390x844 | `docs/3.0/verification/7.2-en-modern.png`, `docs/3.0/verification/7.2-es-modern.png` |
| 7.3 Pairing locked; flow:phone-locked | submit fifth wrong code. 64-pixel error circle/alert 28; Pairing locked; five-failure/10-minute/new-code-unlocks explanation; no submit. | gui-shell, service-home-lock, service-phone-approval, service-home-stream | CAPTURED en/es, modern | 390x844 | `docs/3.0/verification/7.3-en-modern.png`, `docs/3.0/verification/7.3-es-modern.png` |
| 7.4 Hierarchy; flow:phone-hierarchy | authenticate/open Hierarchy. 52-pixel title/mark/waiting count; full chain/indentation/icons/shaped statuses/sample ask count; Without an Overlord/data/mobile; Home network/access-expiry row; bottom Hierarchy/Chats/Waiting navigation. | gui-shell, service-home-lock, service-phone-approval, service-home-stream | CAPTURED en/es, modern | 390x844 | `docs/3.0/verification/7.4-en-modern.png`, `docs/3.0/verification/7.4-es-modern.png` |
| 7.5 A chat; flow:phone-chat | open existing executor chat. | gui-shell, service-home-lock, service-phone-approval, service-home-stream | CAPTURED en/es, modern | 390x844 | `docs/3.0/verification/7.5-en-modern.png`, `docs/3.0/verification/7.5-es-modern.png` |
| 7.6 Waiting; flow:phone-waiting | press Waiting. | gui-shell, service-home-lock, service-phone-approval, service-home-stream | CAPTURED en/es, modern | 390x844 | `docs/3.0/verification/7.6-en-modern.png`, `docs/3.0/verification/7.6-es-modern.png` |
| 7.7 Access ended; flow:phone-closed | advance 12 hours or close access on computer. | gui-shell, service-home-lock, service-phone-approval, service-home-stream | CAPTURED en/es, modern | 390x844 | `docs/3.0/verification/7.7-en-modern.png`, `docs/3.0/verification/7.7-es-modern.png` |
| start 1.1 Repositories found; start:first-repos-found | open a new temporary M1ND with no accepted clusters or Overseer and a read-only discovery fixture: Web holds 19 canonical repositories, Unity 6, Tools 1, with two worktrees belonging to one repository. | gui-start, gui-clusters, gui-shell, service-clusters, service-cluster-git, service-runs-in, service-write-scope, service-lyra | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/start-1.1-en-modern.png`, `docs/3.0/verification/start-1.1-es-modern.png` |
| start 1.2 Create your Overseer; start:first-overseer | accept the repository offer or dismiss it, with no existing Overseer. | gui-start, gui-clusters, gui-shell, service-clusters, service-cluster-git, service-runs-in, service-write-scope, service-lyra | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/start-1.2-en-modern.png`, `docs/3.0/verification/start-1.2-es-modern.png` |
| start 1.3 All clusters; start:first-overview | finish first-open choices with 26 repositories accepted. | gui-start, gui-clusters, gui-shell, service-clusters, service-cluster-git, service-runs-in, service-write-scope, service-lyra | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/start-1.3-en-modern.png`, `docs/3.0/verification/start-1.3-es-modern.png` |
| start 1.4 Zoomed in on a cluster; start:first-inside | double click Web and select shop. | gui-start, gui-clusters, gui-shell, service-clusters, service-cluster-git, service-runs-in, service-write-scope, service-lyra | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/start-1.4-en-modern.png`, `docs/3.0/verification/start-1.4-es-modern.png` |
| start 2.1 New cluster; start:clusters-new-cluster | press New cluster. | gui-start, gui-clusters, gui-shell, service-clusters, service-cluster-git, service-runs-in, service-write-scope, service-lyra | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/start-2.1-en-modern.png`, `docs/3.0/verification/start-2.1-es-modern.png` |
| start 2.2 A cluster with no link; start:clusters-no-link | create ideas with Nothing. | gui-start, gui-clusters, gui-shell, service-clusters, service-cluster-git, service-runs-in, service-write-scope, service-lyra | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/start-2.2-en-modern.png`, `docs/3.0/verification/start-2.2-es-modern.png` |
| start 2.3 New agent; start:clusters-new-agent | select shop and press its inspector plus. | gui-start, gui-clusters, gui-shell, service-clusters, service-cluster-git, service-runs-in, service-write-scope, service-lyra | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/start-2.3-en-modern.png`, `docs/3.0/verification/start-2.3-es-modern.png` |
| start 2.4 Agent, model and effort; start:clusters-runs-in | open Runs in from New agent or Overseer creation. | gui-start, gui-clusters, gui-shell, service-clusters, service-cluster-git, service-runs-in, service-write-scope, service-lyra | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/start-2.4-en-modern.png`, `docs/3.0/verification/start-2.4-es-modern.png` |
| start 2.5 Lyra as the agent; start:clusters-runs-in-lyra | with a verified local service and explicit HIVEM1ND app grants, select Lyra. | gui-start, gui-clusters, gui-shell, service-clusters, service-cluster-git, service-runs-in, service-write-scope, service-lyra | UNREACHED en/es, modern: Lyra is not in the Runs in picker: the local service reports lyra_offline, so there is no connected Lyra model to select. | 1440x900 | |
| start 2.6 A team in a cluster; start:clusters-team | create a shop Overlord and two Executors. | gui-start, gui-clusters, gui-shell, service-clusters, service-cluster-git, service-runs-in, service-write-scope, service-lyra | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/start-2.6-en-modern.png`, `docs/3.0/verification/start-2.6-es-modern.png` |
| start 2.7 The plan in the chat; start:clusters-plan | ask the lead for the cart plan, or choose an existing Void plan/new planner draft. | gui-shell, service-plans, service-runs, service-run-supervision, service-run-messaging, service-run-budget | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/start-2.7-en-modern.png`, `docs/3.0/verification/start-2.7-es-modern.png` |
| start 2.8 The plan runs; start:clusters-running | Run the approved fixture. | gui-shell, service-plans, service-runs, service-run-supervision, service-run-messaging, service-run-budget | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/start-2.8-en-modern.png`, `docs/3.0/verification/start-2.8-es-modern.png` |
| start 2.9 The plan needs you; start:clusters-stuck | use injected clocks to cause no-start 3 min, execution-stall 10 min, planning-stall 30 min and unread 10 min separately. | gui-shell, service-plans, service-runs, service-run-supervision, service-run-messaging, service-run-budget | CAPTURED en/es, modern | 1440x900 | `docs/3.0/verification/start-2.9-en-modern.png`, `docs/3.0/verification/start-2.9-es-modern.png` |
| start 3.1 Across every cluster; start:overseer-chat | select the real Overseer and send Where are we with the launch? Header crown/overseer/idle/Starts fresh every session/More; 12 px Context label and 18% full fixture text,334x6card2 bar with 60accent fill; authored person/Overseer messages across shop/blog/api-gateway; composer Message the Overseer/Across every cluster. | gui-shell, service-context, service-lyra | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/start-3.1-en-modern.png`, `docs/3.0/verification/start-3.1-es-modern.png` |
| start 3.2 Its context is filling; start:overseer-full | advance the real/injected context generation to 82 percent. | gui-shell, service-context, service-lyra | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/start-3.2-en-modern.png`, `docs/3.0/verification/start-3.2-es-modern.png` |
| start 4.1 The chat is messages; start:messages-chat | select executor-shop with a running session, and leave two authored messages unread by executor-shop-2. | gui-shell, service-conversation-data, service-run-signals | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/start-4.1-en-modern.png`, `docs/3.0/verification/start-4.1-es-modern.png` |
| start 4.2 The work is apart; start:messages-work | switch the same inspector to Work. | gui-shell, service-conversation-data, service-run-signals | CAPTURED en/es, modern. Recaptured. | 1440x900 | `docs/3.0/verification/start-4.2-en-modern.png`, `docs/3.0/verification/start-4.2-es-modern.png` |

### Additional look captures

These five Settings captures are saved for the Overmind, at 1440x900 in English. Together with the 188 modern destinations above, they make 193 unique destinations.

- CAPTURED: `docs/3.0/verification/6.1-en-high-contrast.png`.
- CAPTURED: `docs/3.0/verification/6.1-en-nebula.png`.
- CAPTURED: `docs/3.0/verification/6.1-en-txmska.png`.
- CAPTURED: `docs/3.0/verification/6.1-en-coffee-cat.png`.
- CAPTURED: `docs/3.0/verification/6.1-en-ntk.png`.

### Final automated gates on the T064 source

A search of test/ for each changed module path and basename (engine/service/service.mjs, engine/service/store.mjs, test/gui-data.mjs and test/gui-fixture.mjs) selected 48 importing/reading test files. The full suite ran all 133 test files, including all 48 and the route matrix, on the final source. No HTTP contract route was added or changed.

npm.cmd test: exit 0; 1626 tests, 2 suites, 1625 passed, 0 failed, 0 canceled, 1 skipped, 0 todo; 225010.5132 ms, under a 600000 ms process-tree limit. npm.cmd run test:core: exit 0; all 115 core test files, 1307 tests, 2 suites, 1306 passed, 0 failed, 0 canceled, 1 skipped, 0 todo; 195090.0155 ms, under the same limit. Both runs executed every new T064 case and both cold-recovery regression groups.

Both suites skipped only "the home scan tolerates a directory it cannot list", reason: "This platform does not enforce directory permissions for the current process." This is the historical Windows permission limitation, not an observed permission-denial pass.

The existing C01 to C15 gates remain in the full run: setup/migration/installation and machine-owned Settings; clusters, alias/removal and Undo; native launch, write-root/Git consent, context and Lyra wire/tools; authored messages and explicit recipient receipts; editor bundles, crash recovery, sync, History, source/caret and batch replacement; Add pin/check/scope/update/removal; plan approval, verified report/exit/owned cleanup, durable supervision, wake caps and budgets; QR, phone pairing/authority, palettes and named controls. test/service-api.test.mjs checks a real success and an authority/boundary failure for each route with hit() coverage; auth/idempotency and crash/sync suites retain their separate assertions.

npm.cmd run lint: exit 0; 231 Markdown files, 0 issues. npm.cmd run build: exit 0; Built hivem1nd@3.0.0: dist/hivem1nd-3.0.0.tgz (391 files, 6 roles, 10 commands, 15 features), browser assets packaged. The generated archive was restored to its exact pre-build bytes. No deployment, real native agent session, staging or commit was performed. All completed test/build process trees exited normally.

The final literal Proof command, node --test test/service-integration.test.mjs, exited 0: 12 passed, 0 failed, 0 canceled, 0 skipped; 25766.1717 ms, under a 180000 ms process-tree limit. git diff --check exited 0 with no standard output; Git reported only the existing LF-to-CRLF working-copy notices. The 108 mapping records and 193 unique pending capture paths were counted from this evidence file. No unresolved automated failure remains; visual/native-platform acceptance stays explicitly pending for the Overmind.
