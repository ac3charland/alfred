---
branch: claude/task-creation-animation-5tv628
---

# Task creation animation (ALF-20)

*2026-06-29T15:20:09.709Z*

A newly-added task now animates into a visible list: its height expands from zero (pushing the rows below it down) while its content fades and slides in from above. The trigger is the optimistic temp id a row carries between its insert and the server reconcile, so only freshly-added rows animate — a server-seeded page load or view switch does not.

### Capturing into the inbox — the new row slides in from above and pushes the rest down

![Capturing a thought: the new inbox row expands in from the top and pushes the others down](task-creation-animation-video-1.gif)

### Adding a subtask — it appears at the bottom of its siblings, pushing the content below the subtree down

![Adding a subtask: the new row enters at the bottom of its siblings and pushes the rows below the subtree down](task-creation-animation-video-2.gif)
