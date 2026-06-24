---
branch: claude/lucid-maxwell-0lwsby
---

# ALF-55: Fix Task/Code switcher spacing to space-between

*2026-06-24T21:39:40.559Z*

The ViewSwitcher container previously used inline-flex with gap-1, making it shrink-wrap its content with a fixed small gap between the two buttons. This fix changes it to flex with justify-between so the Tasks and Code segments are pushed to opposite ends of the full-width container, matching the width of the sidebar and mobile drawer.

Tasks active (default route /): Tasks is highlighted teal on the left, Code is muted on the right.

![](view-switcher-spacing-image-1.png)

Code active (route /code): Tasks is muted on the left, Code is highlighted teal on the right.

![](view-switcher-spacing-image-2.png)
