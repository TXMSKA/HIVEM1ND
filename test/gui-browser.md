# GUI browser checks

Observations from Chrome against the isolated fixture. Each scenario used the desktop link printed by `test/gui-fixture.mjs`. The 200% rows use a 720 by 450 layout viewport at device scale 2. Screenshots stayed outside the repository. The session fragment was cleared on the first load. The credential was not present in the document. Console errors were empty in every row.

## Step 3 shell

| Viewport | Look | Language | Expected | Observed | Failure | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1440x900 | modern | en | Set M shell, bar 52, footer 30, side 266, inspector 366, no clip, no console errors | Background rgb(15, 11, 19), accent #bdcd79, panel rgb(24, 18, 29), radius 20px. Bar 1440x52. Footer 1440x30 at top 870. Side 266x806. Stage 760x806. Inspector 366x806 at left 1062. Page scroll width matched the viewport. English copy showed Map, 4 waiting, Hierarchy, 11 units, 5 unread, 3 issues, the three service issue messages, the temporary panel message, empty inspector guidance, Service on DESKTOP, Saved on this machine, and Last read 12:00 UTC. | none | this file |
| 1024x768 | modern | en | Narrow desktop keeps the desktop credential. Inspector is a dismissible panel. No clip and no console errors. | Same modern palette and English copy. Bar 1024x52. Footer at top 738. Side 266x674. Stage 722x674. Inspector display none until its header control opens it. Page scroll width matched the viewport. | none | this file |
| 720x450 at device scale 2 | modern | en | 200% zoom keeps the bar, footer, and scrolling panels usable. | Bar wrapped to 91px and still showed Map, Blueprint, Document, Focus, and 4 waiting. Footer 720x30 at top 420. Side 266x317 with scroll height 469, so the issue list scrolls inside the panel. Stage 418x317. Inspector display none. Page scroll width matched the viewport. | none | this file |
| 1440x900 | high-contrast | en | Set A: black surfaces, gold accent, 10px radius, same shell geometry. | Background rgb(5, 5, 5), accent #d4b06a, panel rgb(11, 11, 11), radius 10px. Geometry matched the modern 1440 row. English copy. | none | this file |
| 1024x768 | high-contrast | en | Set A at the narrow desktop width. | High contrast palette and English copy. Geometry matched the modern 1024 row, including the closed inspector. | none | this file |
| 720x450 at device scale 2 | high-contrast | en | Set A at 200% zoom. | High contrast palette. Bar height 95. Footer at top 420. Side scroll height 471 inside a 313px panel. Inspector display none. | none | this file |
| 1440x900 | modern | es | Spanish chrome on the modern palette. | Language es. Copy included Mapa, Documento, Concentración, 4 pendientes, Jerarquía, Instantánea, 11 unidades, 5 sin leer, and 3 incidencias. Service issue text stayed in the service language. Geometry matched the modern 1440 row. | none | this file |
| 1024x768 | modern | es | Spanish chrome at the narrow desktop width. | Spanish chrome and modern palette. Geometry matched the modern 1024 row. | none | this file |
| 720x450 at device scale 2 | modern | es | Spanish chrome at 200% zoom. | Spanish chrome. Bar height 91. Footer at top 420. Side scroll height 490 inside a 317px panel. Inspector display none. | none | this file |

## Step 4 lists

The large fixture was opened at 1440x900. End moved focus to the last hierarchy row and kept that row inside the list pane. Searching `unit-1200` left the snapshot count at 1211 and the filtered total at 1. The bulk group showed that row. Enter selected it. A later unit change kept the same filtered row and total. Compact rows stayed under 100. There were no console errors.

| Viewport | Look | Language | Expected | Observed | Failure | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1440x900 | modern | en | Search reaches unit 1200. The group can be expanded. Keyboard activation selects it. Fewer than 100 compact rows are mounted. The total stays correct after a list change. | Before the search, 17 compact rows were mounted. The list scroll height was 612 and its client height was 293. End focused root:incubator inside the pane. The snapshot read 1211 units and the list total was 1211. After searching unit-1200 and activating that row with Enter, 3 compact rows were mounted, the filtered total was 1, the row read unit-1200 Out, and aria-selected was true. The snapshot still read 1211 units. After a unit change event, the filtered total stayed 1 and the same row stayed selected. | none | this file |

## Step 5 map

A local drag moved one circle. Escape restored that drag. A reverse marquee selected the visible circles, including adjutant, executive, and overseer. Zoom moved a circle, and a second drag used the new scale. Double-clicking executor-shop in Hierarchy centered it and selected it. No layout write was part of this gate.

| Viewport | Look | Language | Expected | Observed | Failure | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1440x900 | modern | en | Free placement, local move, reverse marquee, zoom, cancelled drag, and Hierarchy double-click centers the unit. | Background rgb(15, 11, 19), accent #bdcd79. master moved from left 698 to 758. The following drag was cancelled and the circle returned to 758. The reverse marquee selected 9 circles, including root:adjutant, root:executive, and root:overseer. Wheel zoom moved overseer from 698 to 700.59375. Double-clicking project:shop:executor-shop set aria-pressed and its center delta to 0. The inspector read executor-shop Waiting. | none | this file |
| 1440x900 | high-contrast | en | The same gestures on set A. | Background rgb(5, 5, 5), accent #d4b06a. master moved from 699 to 759 and the cancelled drag returned it there. The reverse marquee selected the same 9 circles. Zoom moved overseer from 699 to 701.6875. Hierarchy double-click centered executor-shop with center delta 0. | none | this file |

## Step 6 actions

Chrome at 1440x900 on the modern English shell. Dragging the overseer handle onto adjutant showed "adjutant will report to overseer." Cancel left the inspector note empty. Confirm recorded root:adjutant reporting to root:overseer. A group connect from overseer to adjutant and master showed both sentences. Confirm kept the adjutant result and recorded root:master invalid_lead. Creating a unit on OFFLINE showed "OFFLINE is unavailable." Starting overseer showed "The session is queued." The same request then showed "The session failed. Nothing was launched." Stopping the shop session showed "The session is stopping." and, after acknowledgment, "The session stopped."

| Viewport | Look | Language | Expected | Observed | Failure | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1440x900 | modern | en | Confirm and cancel a connection. A group connect keeps one invalid target. An unavailable machine is named. A session goes queued, then failed. A stop goes stopping, then stopped. | Cancel copy was "adjutant will report to overseer." and the note stayed empty. Confirm recorded root:adjutant root:overseer. Group copy named adjutant and master. The result was root:adjutant root:overseer and root:master invalid_lead. The unavailable note was "OFFLINE is unavailable." The session note went from "The session is queued." to "The session failed. Nothing was launched." The stop note went from "The session is stopping." to "The session stopped." | none | this file |

## Step 7 chats

Chrome at 1440x900 on the modern English shell. A hierarchy double-click selected executor-shop on the map and opened its direct chat. A new three-member group was empty. Two replies appeared. Pin, unlist, and reopen completed. Older history for 400 messages kept the anchor in place. Opening a mailbox did not mark it read.

| Viewport | Look | Language | Expected | Observed | Failure | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1440x900 | modern | en | Direct chat from a double-click, a three-member group, two replies, pin, unlist, reopen, older history, and a mailbox inspection that does not mark mail read. | executor-shop was aria-pressed and its direct chat opened. The new group read "No messages yet." and had 3 members. The transcript then showed First reply and Second reply. The chat pinned, left the list, and was listed again. After 400 messages, the total read 400 and the anchor delta was 0. The offline mailbox stayed "0 mailbox" on a second look. The shop mailbox stayed "1 read:false" on a second look. | none | this file |
