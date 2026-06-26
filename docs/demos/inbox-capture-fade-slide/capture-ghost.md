---
branch: claude/inbox-capture-fade-slide-s9nhzw
---

# Inbox capture: fade and slide right

*2026-06-26T21:13:02.644Z*

Capturing a thought now sends it off with a flourish: on Enter (or the Capture button), a transient "ghost" copy of the just-typed text fades out and slides to the right out of the capture box, while the textarea clears optimistically underneath so the next thought can be typed immediately. The ghost removes itself on `animationend`; it is skipped entirely under `prefers-reduced-motion` and in compact (subtask) mode.

The serif "What's on your mind?" prompt is now a resting hint: it shows only while the box is empty AND the user has not yet typed this focus session. So it appears on landing, disappears the moment you type, and — crucially — does NOT flash back after a capture clears the box while it is still focused. It returns once focus leaves the box.

![captured text fades and slides right; the prompt does not flash back](capture-ghost-video-1.gif)
