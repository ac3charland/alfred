---
branch: claude/item-details-escape-click-c41iwv
---

# Close item details on Escape / click outside (ALF-78)

*2026-07-03T00:35:34.921Z*

The inline detail panel (the ⋯ menu's "Open details") could previously only be closed by re-opening the ⋯ menu and choosing "Open details" again. ALF-78 lets you dismiss it the way every other transient surface dismisses: press **Escape**, or click **outside the row**. Interacting with the panel itself — its Due/Repeat/Priority pickers or the Notes field — never closes it, and while a picker popover is open the first Escape closes the popover, not the panel.

### Escape closes the panel

![The detail panel open below the row](dismiss-detail-panel-image-1.png)

Pressing **Escape** dismisses it — the row returns to its resting state:

![The panel closed after Escape](dismiss-detail-panel-image-2.png)

### Clicking outside the row closes the panel

![The detail panel re-opened](dismiss-detail-panel-image-3.png)

A pointer press anywhere outside the row — here, the empty space below it — dismisses the panel:

![The panel closed after clicking outside](dismiss-detail-panel-image-4.png)
