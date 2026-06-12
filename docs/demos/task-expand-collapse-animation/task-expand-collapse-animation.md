# Task expand/collapse animation

*2026-06-12T17:23:58.442Z*

Parent tasks now smoothly animate open and closed. Clicking the expand chevron slides the subtask rows in using a CSS grid-template-rows transition (height: 0fr → 1fr), with the text fading in on top. Collapsing reverses the animation — text fades out first, then the region collapses. Both directions respect prefers-reduced-motion.

**Before — collapsed:** badge shows child count (3)

![collapsed state](task-expand-collapse-animation-image-2.png)

**After — expanded:** subtasks slide in with a smooth height + opacity animation

![expanded state](task-expand-collapse-animation-image-3.png)

**Animated:** the GIF below captures the full expand → collapse cycle (plays on loop)

![task expand collapse animation](task-expand-collapse-animation-video-3.gif)
