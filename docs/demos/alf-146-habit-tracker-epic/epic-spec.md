---
branch: claude/habit-tracker-epic-jjqwn5
---

# ALF-146 — Habit Tracker epic spec

*2026-07-28T03:12:43.530Z*

This is an **epic-refinement** branch: the deliverable is the epic spec at `docs/specs/epics/ALF-146.html`, not app behavior. Nothing under `frontend/`, `workers/` or `database/` changed. The evidence below is that artifact — the self-contained HTML page a reviewer opens via the PR's htmlpreview link — rendered in a browser.

The spec has been through **two refinement rounds**. Round two reopened four decisions after the owner pushed back; those carry a `revised` tag in the document so the history is visible without a second file.

## The revised decisions

Round two changed what a habit *is*. A habit now holds **1..n criteria** (the reference habit is "up by 6:15" **and** "outside for light", which succeed or fail as one morning), the day gains a **partial** state, and the streak gains a **rolling miss allowance** — which forced a rethink of what an unlogged day does.

![](epic-spec-image-1.png)

## The streak engine

The allowance made the streak rules the riskiest logic in the epic, so §3 pins them precisely — including the rule that collapses four cases into one sentence: anything that isn't `met` or `skipped` spends allowance, so *forgetting* to log costs exactly what *failing* costs.

![](epic-spec-image-2.png)

## §6 — the interactive UI picker

The UI is the one decision deliberately left open. Round one settled the shape (a grid, big cells, tap-to-log, values on tap); round two drops the layout group — it wasn't independent of the visualization — and opens five that are: grid orientation, streak connector style, the day editor, where the six stats live, and how the formation stage is shown.

Toggling is **pure CSS** (`:has()` on the checked radio), so it works with JavaScript disabled and renders faithfully through htmlpreview; only the Copy button needs JS. Default state:

![](epic-spec-image-3.png)

And after clicking a different radio in **every one** of the five groups — `#o-gh`, `#k-rail`, `#g-seg`, `#s-chips`, `#f-ladder`. Every mockup swapped, and the metadata block at the bottom rewrote itself to match:

![](epic-spec-image-4.png)

Reading the block out of the live DOM after those five clicks returns exactly the selections, which is what makes it copy-pasteable back into the thread: `orientation: weeks-as-columns` · `connector: under-rail` · `day-editor: verdict-first` · `stats: header-chips` · `formation: four-stage-ladder`.

The mockups are behaviourally faithful, not decorative: a connector is only drawn between two days the streak actually links, the links either side of a forgiven day render dashed, and a real break (allowance already spent) shows no connector at all.

## What this branch does not contain

No migration, no route handler, no component — this is the epic spec plus this demo doc. The habit tables, the criterion evaluator, the streak engine, the API and the UI are the twelve story slices sketched in §8, each refined and built in its own session.
