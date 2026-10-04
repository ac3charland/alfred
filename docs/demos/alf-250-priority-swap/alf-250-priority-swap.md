---
branch: alf-334/replay-250-high-r2
---

# ALF-250 — Backlog priority nudges stop snapping back

*2026-10-04T21:04:23.552Z*

The Backlog's single chevrons swap a story with its visible neighbour: the row moves at once (optimistic), and the swap syncs to `swap_code_priority` afterwards. Two things fed the screen server news describing a rank it had already moved past, so rows jumped back up and slid down, and a click made in that window swapped from a position the user wasn't looking at:

1. **The swap RPC parked the story at a sentinel rank** — `min(priority) - 1`, above the whole Backlog — before landing it. Supabase realtime echoes every row write, so the parking write reached the browser as a real move: the story flashed to the **top of the list**, then slid back down.
2. **The store applied every server answer and realtime echo as current**, even when the user had already clicked again. Answers for an earlier step of a burst, an earlier commit's answer, and late echoes of this tab's own writes all overwrote the newer optimistic rank, and two commits could be in flight at once.

The fix: migration `0042` swaps both rows in one statement (the deferrable unique constraint from `0031` checks at statement end), and a `PriorityLedger` in the code store drops priority news older than the screen and runs priority commits one at a time.

## The swap's realtime echoes, before 0042

Three stories on a throwaway Postgres (the integration suite's cluster and migrations), an audit trigger logging every UPDATE the browser would be sent, then the Down chevron on the middle story. Echo 1 lands ALF-2 at `-4`, above ALF-3 (`-3`): the top of the Backlog.

```bash
node docs/demos/alf-250-priority-swap/swap-writes.mjs before
```

```output
Backlog:        ALF-3@-3  ALF-2@-2  ALF-1@-1
Down on ALF-2:   select swap_code_priority('ALF-2', 'ALF-1')
  realtime echo 1: ALF-2 → -4
  realtime echo 2: ALF-1 → -2
  realtime echo 3: ALF-2 → -1
Backlog:        ALF-3@-3  ALF-1@-2  ALF-2@-1
```

## After 0042

The same click now makes two writes, each straight to its final rank, so there is nothing transient to echo.

```bash
node docs/demos/alf-250-priority-swap/swap-writes.mjs after
```

```output
Backlog:        ALF-3@-3  ALF-2@-2  ALF-1@-1
Down on ALF-2:   select swap_code_priority('ALF-2', 'ALF-1')
  realtime echo 1: ALF-1 → -2
  realtime echo 2: ALF-2 → -1
Backlog:        ALF-3@-3  ALF-1@-2  ALF-2@-1
```

## The browser half

The store-side defects are timing races between optimistic clicks, request answers and realtime echoes, with no single screen state to capture. They're pinned by a seeded fuzz of the real `BacklogList` in the project-filtered view, against a simulated server whose answers and echoes arrive at random lags (`frontend/components/code/backlog/backlog-list.test.tsx`): at every click the list on screen must be the order the clicks so far describe, and once everything settles the server must hold it too. Every seed fails on the old store.
