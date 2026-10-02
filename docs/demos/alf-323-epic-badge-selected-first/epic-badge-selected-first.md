---
branch: claude/epic-badge-inbox-selection-0j25hn
---

# ALF-323 — the epic badge's picker leads with the current epic

*2026-10-02T18:41:55.505Z*

Tapping an Inbox row's epic badge opens a picker of the project's epics. The list used to follow store order, so a long project buried the current choice somewhere down the list (its tick was the only clue). It now leads with the selected epic; the rest keep their order. The same shared option builder feeds the detail-panel Epic chip and the row menu's Epic… submenu, so all three agree.

Below: the live Inbox row (seeded with five epics) whose badge reads ALF-103. That epic is fourth in store order, yet the popover lists it first, ticked, with Inbox triage, LLM processing, Habits and Wiki reader following in their original order.

![](epic-badge-selected-first-image-1.png)
