---
branch: claude/module-switcher-resize-cf3quk
---

# Module switcher hugs its content

*2026-07-03T16:58:08.493Z*

ALF-93: the Tasks ⇄ Code module switcher previously used `justify-between` on a full-width container, so the segmented control stretched across the entire sidebar with a wide gap between the two segments. It now hugs its content — `w-fit` with `gap-1` — so the control is only as wide as the two buttons need.

The visual-snapshot diff makes the change concrete — three panels: **left** the old full-width baseline (1184px wide), **middle** the changed pixels, **right** the new render that hugs its content (130px wide). Same for both the Tasks-active and Code-active states.

![](module-switcher-resize-image-1.png)

![](module-switcher-resize-image-2.png)

The approved new baselines — the switcher as it now renders in the sidebar, snug around its two segments:

![](module-switcher-resize-image-3.png)

![](module-switcher-resize-image-4.png)
