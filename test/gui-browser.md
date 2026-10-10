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
