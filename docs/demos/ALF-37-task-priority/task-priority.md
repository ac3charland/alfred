---
branch: claude/blissful-galileo-9q1y5c
---

# View all tasks by priority (ALF-37)

*2026-06-24T16:58:35.547Z*

ALF-37 adds a discrete **priority level** (High / Medium / Low) to tasks — settable from the task editor menu and shown as a colour-coded badge on each row — plus a new **By Priority** view at `/priority` that lists every top-level task across Inbox and all folders, ranked by priority with the due date as the within-level tiebreaker. It mirrors the Code module's cross-cutting Backlog, but ordered by a real priority field instead of a manual rank.

## The ranking, demonstrated

The order is the heart of the ticket. This runnable script (`priority-demo.ts`, beside this doc) calls the **real** ranking function the view uses — `rankByPriority` from `frontend/lib/priority.ts` — and prints its output. It's bundled with esbuild (which resolves the `@/` alias from the frontend tsconfig) and run with node, so the captured output is the production logic's own. It covers: level order (High → Medium → Low → unprioritised); the due-date tiebreak within a level (earliest / most overdue first, no-due last); and the **subtree rollup** — a Low-priority parent hiding a High, overdue *active* subtask floats above a plain Medium task, while a *completed* High subtask leaves the parent Low.

```bash
node_modules/.bin/esbuild docs/demos/ALF-37-task-priority/priority-demo.ts --bundle --platform=node --tsconfig=frontend/tsconfig.json 2>/dev/null | node
```

```output
Level set & rank (lower = higher in the list):
  High     rank 0
  Medium   rank 1
  Low      rank 2
  (none)   rank 3

Ranked by level, due date breaks ties within a level:
  Reply to landlord          [high  ] due 2026-06-10   (Home)
  Ship the priority migration [high  ] due 2026-06-25   (Inbox)
  Draft Q3 planning doc      [medium] due no due date  (Work)
  Tidy bookmarks             [low   ] due no due date  (Inbox)
  Someday: learn the cello   [—     ] due no due date  (Inbox)

Subtree rollup — active High subtask lifts its Low parent above a Medium task:
  Low parent (active urgent child) [low   ] due no due date  (Inbox)
  Plain medium task          [medium] due no due date  (Inbox)

…but a COMPLETED High subtask does not lift the parent — it stays Low, below Medium:
  Plain medium task          [medium] due no due date  (Inbox)
  Low parent (completed child) [low   ] due no due date  (Inbox)
```

## Ordering within a folder

The same ranking now orders each **folder** too (the Inbox stays capture-first). A folder ranks **every level** — top-level rows and their subtasks — by priority → due date → created_at, using each node's **own** priority (no subtree rollup, since subtasks are their own visible rows here). This calls the real `sortNodesByPriority` (`folder-order-demo.ts`, beside this doc):

```bash
node_modules/.bin/esbuild docs/demos/ALF-37-task-priority/folder-order-demo.ts --bundle --platform=node --tsconfig=frontend/tsconfig.json 2>/dev/null | node
```

```output
Folder "Work" — ranked by priority at every level (own key, no rollup):
  Reply to the client    [high  ]
  Plan the sprint        [medium]
    └ Book the room      [high  ]
    └ Write the agenda   [low   ]
  Tidy the desk          [low   ]
  Someday idea           [—     ]
```
