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
