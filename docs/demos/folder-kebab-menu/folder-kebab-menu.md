---
branch: claude/exciting-feynman-hb18sl
---

# Folder kebab menu: Edit/Delete dropdown + rename form fix

*2026-06-13T04:35:04.233Z*

Previously the folder nav showed a rename button (MoreHorizontal) and a separate trash/delete button on hover. Two problems: (1) the delete button was always visible on hover instead of being in a menu, and (2) the checkmark confirm button for the rename form was cut off at the sidebar's right edge.

**Fix 1 — dropdown menu.** Hovering a folder now reveals a single kebab button (MoreHorizontal). Clicking it opens a Radix DropdownMenu with Edit and Delete items. Edit opens the inline rename form; Delete removes the folder. The separate, always-visible delete button is gone.

Hover a folder row — the single kebab  button appears at the right edge:

![](folder-kebab-menu-image-1.png)

Clicking the kebab opens the menu with Edit and Delete:

![](folder-kebab-menu-image-2.png)

**Fix 2 — rename checkmark no longer cut off.** The rename form previously used left-padding only (pl-3), causing the confirm button to sit flush at the sidebar's clipping boundary. Changed to symmetric padding (px-3) so the checkmark has room on the right.

Selecting Edit opens the inline rename input. Playwright verified the confirm button has a non-null bounding box (fully within the viewport, not clipped):

![](folder-kebab-menu-image-3.png)
