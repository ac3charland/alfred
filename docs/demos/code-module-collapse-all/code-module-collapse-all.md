---
branch: claude/friendly-knuth-nofedx
---

# Code module: Collapse all epics button

*2026-06-15T15:04:02.601Z*

Added a 'Collapse all' icon button to the code module board header, next to the 'Show blocked' toggle. Clicking it collapses all currently-visible epics in one action. The button mirrors the tasks module's CollapseAllButton: disabled when all epics are already collapsed, enabled as soon as at least one is open.

Before: both epics expanded. The 'Collapse all' button (ChevronsDownUp icon) appears enabled at the top right, next to 'Show blocked'.

![](code-module-collapse-all-image-1.png)

After clicking 'Collapse all': both epics collapse to their header rows. The button becomes disabled (no more open epics to collapse).

![](code-module-collapse-all-image-2.png)
