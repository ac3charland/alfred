---
branch: claude/alf-66-subtask-animation-r3ai7r
---

# Subtask entry field animates in/out (ALF-66)

*2026-06-29T18:35:08.829Z*

The inline "Add subtask" field now grows in with a height-grow + fade when opened, and shrinks back out with a fade when dismissed (Escape, blur, or toggling the button again). Built from the reusable AnimatedHeightReveal atom (animate-expand-y / animate-collapse-y for height + animate-fade-in / animate-fade-out for opacity), with motion-reduce guards and a target-guarded animationend that unmounts the field once its collapse finishes. Under prefers-reduced-motion the field appears and disappears instantly. The GIF below shows the field growing in, then shrinking out.

![subtask entry field grows in then shrinks out](subtask-field-animation-video-1.gif)
