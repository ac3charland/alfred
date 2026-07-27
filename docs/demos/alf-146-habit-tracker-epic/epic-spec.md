---
branch: claude/habit-tracker-epic-jjqwn5
---

# ALF-146 — Habit Tracker epic spec

*2026-07-27T17:01:49.736Z*

This is an **epic-refinement** branch: the deliverable is the epic spec at `docs/specs/epics/ALF-146.html`, not app behavior. Nothing under `frontend/`, `workers/` or `database/` changed. The evidence below is that artifact — the self-contained HTML page a reviewer opens via the PR's htmlpreview link — rendered in a browser.

## The document

Problem space — why a habit is not a task, and why routing one through `items` would drown the task system.

![](epic-spec-image-1.png)

Each settled decision carries its rationale, and §3 pins the data model, the streak rules, and the data flow that later stories build against.

![](epic-spec-image-2.png)

## §5 — the interactive UI picker

The one decision deliberately left open is the UI. §5 of the spec is a live picker: four independent option groups, each with working mockups, and a metadata block at the bottom that the owner copies and pastes back. Toggling is **pure CSS** (`:has()` on the checked radio), so it works with JavaScript disabled and renders faithfully through htmlpreview — only the Copy button needs JS.

Here it is in its default state (contribution grid / check-off list / stacked cards / in-cell values):

![](epic-spec-image-3.png)

And after clicking a different radio in **every** group — `#h-strip`, `#t-cell`, `#l-table`, `#m-hover`. Every mockup swapped, and the metadata block at the bottom re-wrote itself to match:

![](epic-spec-image-4.png)

Reading the block out of the live DOM after those four clicks returns exactly the selections — which is what makes it copy-pasteable back into the thread:

`alfred-habits-ui` · `history: chain-strip` · `today-logging: click-the-cell` ·
`layout: dense-table` · `measurement: on-hover`

## What this branch does not contain

No migration, no route handler, no component — this is the epic spec plus this demo doc. The habit
tables, the streak engine, the API and the UI are the ten story slices sketched in §7, each refined
and built in its own session.
