---
branch: claude/alf-99-description-truncate-d09msi
---

# Task description preview truncates on mobile (ALF-99)

*2026-07-06T14:46:17.424Z*

**Bug (ALF-99):** on a phone-width card the one-line notes/description preview under a task title did not truncate — a long note pushed the whole card past the viewport instead of showing an ellipsis.

**Root cause:** each row's collapse wrapper is a `display:grid` track. A grid item's automatic minimum size is `min-content`, so the (nowrap) preview forced the grid column to the note's full width, blowing the card past the screen — leaving nothing for `truncate` to clip. The fix adds `min-w-0` to that grid item so it can shrink below its content and the ancestor width stays bounded.

### Before — the card spills off the right edge (390px viewport)

![](mobile-notes-truncate-image-1.png)

The note runs straight past the card's right edge; the card loses its rounded corner and the row actions are pushed off-screen. No ellipsis.

### After — the preview clips to one line with an ellipsis (390px viewport)

![](mobile-notes-truncate-image-2.png)

The card fits the viewport, the note ends in an ellipsis, and the row actions (+ / ⋯) stay visible. Captured from the `Tasks/TaskRow → MobileNotesTruncate` story, which also locks this as a committed image snapshot.
