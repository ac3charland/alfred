---
branch: claude/inbox-capture-fade-slide-s9nhzw
---

# Inbox capture: fade and slide right

*2026-06-26T20:00:44.384Z*

Capturing a thought now sends it off with a flourish: on Enter (or the Capture button), a transient "ghost" copy of the just-typed text fades out and slides to the right out of the capture box, while the textarea clears optimistically underneath so the next thought can be typed immediately. The ghost removes itself on `animationend`; it is skipped entirely under `prefers-reduced-motion` and in compact (subtask) mode.

![captured text fades and slides right out of the box](capture-ghost-video-1.gif)
