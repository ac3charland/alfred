---
branch: claude/alfred-debounce-priority-reorder-tniigg
---

# Rapid backlog chevron clicks debounce to one reorder call

*2026-07-07T21:54:36.191Z*

ALF-111: the Backlog's chevron reorder/move buttons (`backlog-row.tsx`) now debounce (200ms, trailing edge) on rapid repeat clicks. Instead of firing one `reorderStory`/`moveStory` call per click, a burst collapses into a single call using the LAST click within the window — the earlier clicks leave no trace, so a fast tap-tap doesn't spam the API or race on stale neighbour refs.

![Up then Down clicked rapidly on ALF-4 — after the debounce settles, only the Down swap applies (ALF-4 ends up below ALF-5); the Up click never reaches the network](chevron-debounce-video-1.gif)
