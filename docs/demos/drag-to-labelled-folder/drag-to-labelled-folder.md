---
branch: claude/alf-216-drag-to-labelled-folder
---

# Dragging an Inbox task onto the folder it is labelled with files it (ALF-216)

*2026-09-30T05:04:03.925Z*

The classifier can fill in `folder_id` on an item still sitting in the Inbox — a label naming where it would land, shown as the row's folder chip. Until ALF-216, dragging that item onto **any other** folder filed it, but dragging it onto **the folder its label names** — the one the owner is most likely to pick — did nothing. The drop handler treated the label as the task's current location, so the drop read as "already there" and was discarded. The fix asks where the task actually lives (`residentFolderId`, which is `null` until the item is dispatched) instead.

**Start** — "Renew the parking permit" is in the Inbox, labelled **Work** by the classifier (the chip on the right). It has not been dispatched.

![](drag-to-labelled-folder-image-1.png)

**Drag it onto Work** — the sidebar Work target lights up under the dragged ghost, exactly as for any folder.

![](drag-to-labelled-folder-image-2.png)

**Before the fix: release** — nothing happens. The task is still in the Inbox (the count still reads 2) and still only labelled Work.

![](drag-to-labelled-folder-image-3.png)

**After the fix: release** — the same drop dispatches the task. It leaves the Inbox at once (the count drops to 1)…

![](drag-to-labelled-folder-image-4.png)

…and is now filed in Work as a task.

![](drag-to-labelled-folder-image-5.png)
