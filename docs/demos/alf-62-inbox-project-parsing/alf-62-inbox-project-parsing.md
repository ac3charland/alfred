---
branch: claude/alf-62-project-parsing-60p370
---

# ALF-62 — Project parsing in the Inbox capture box

*2026-07-07T01:42:50.311Z*

Prefixing an Inbox capture with a recognized `<project name|key>:` (case-insensitive) classifies it as **Code**, assigns that project, strips the prefix, and capitalizes the first letter of the remainder. Everything else is captured verbatim as an `unclassified` item, exactly as before. Parsing runs **only** in the main Inbox capture box — folder captures, inline subtask captures, and the Siri `POST /api/items` path are untouched. A key match (unique) wins; an ambiguous duplicate name is treated as no match.

**Capture `Alfred: build the thing` in the Inbox.** The row lands as a Code item titled "Build the thing" (prefix stripped, first letter capitalized), showing the Code type badge and the assigned project's key as a colored chip (**ALF**). `raw_capture` keeps the original `Alfred: build the thing` for future re-processing.

![](alf-62-inbox-project-parsing-image-1.png)

**Opening _Send to Code module…_ on that item pre-selects its assigned project.** The gate opens with **Alfred** already selected — the user only has to pick an epic. In the bulk path, a selection that unanimously shares one assigned project pre-selects **and locks** it (a read-only chip); a mixed or absent selection falls back to today's interactive picker.

![](alf-62-inbox-project-parsing-image-2.png)
