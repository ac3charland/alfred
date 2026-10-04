---
branch: alf-334/replay-250-high-r4
---

# ALF-250: the Backlog's single-chevron swap no longer jumps back or stalls

*2026-10-04T20:58:30.574Z*

Nudging a story Down in the Backlog made it jump back up and slide down, and after a few clicks the arrows stopped moving it. Two causes, one on each side of the wire:

1. **Server — `swap_code_priority`.** It parked the story at `min(priority) - 1` (the top of the whole Backlog) before landing it. Every row version is a realtime UPDATE an open Backlog applies, so the story flashed to the top. And it read both ranks without locking, so a second sync of the same story (the next burst of clicks syncing while the previous one is still committing) read pre-commit ranks and 409'd, leaving the story one slot short.
2. **Browser — the code store.** Server copies of a rank that land while a later swap of that story is still unsynced (a realtime echo, or an earlier step's response in the same burst) overwrote the newer optimistic rank. That dragged the story back up, and could leave it tied with the neighbour it had just passed. Swapping two equal ranks changes nothing, so the arrows looked dead.

Below, a throwaway Postgres is built from the real migrations twice: once with everything before `0042`, once with all of them. Four stories ALF-1..ALF-4 are created (ALF-4 on top). Then (1) ALF-4 is nudged Down once while every write is recorded (each one is a realtime UPDATE the browser receives), and (2) two syncs of ALF-4 overlap: Down past ALF-2, and before that commits, Down again past ALF-1.

```bash
node docs/demos/alf-250-backlog-swap/swap-replay.mts 2>&1
```

```output

== before 0042 (main) ==
Backlog before:  ALF-4=-4  ALF-3=-3  ALF-2=-2  ALF-1=-1
Realtime UPDATEs one Down click sends the browser:
  ALF-4 -> -5
  ALF-3 -> -4
  ALF-4 -> -3
Backlog after:   ALF-3=-4  ALF-4=-3  ALF-2=-2  ALF-1=-1
Overlapping second swap:  ERROR: duplicate key value violates unique constraint "code_items_priority_key"
Backlog after both:  ALF-3=-4  ALF-2=-3  ALF-4=-2  ALF-1=-1

== with 0042_atomic_priority_swap.sql ==
Backlog before:  ALF-4=-4  ALF-3=-3  ALF-2=-2  ALF-1=-1
Realtime UPDATEs one Down click sends the browser:
  ALF-3 -> -4
  ALF-4 -> -3
Backlog after:   ALF-3=-4  ALF-4=-3  ALF-2=-2  ALF-1=-1
Overlapping second swap:  ok
Backlog after both:  ALF-3=-4  ALF-2=-3  ALF-1=-2  ALF-4=-1
```

Before `0042`, one Down click sends the browser three UPDATEs, and the first parks ALF-4 at -5, above every other story. That is the flash to the top. The overlapping second click 409s and ALF-4 stops at -2, one slot short of where the clicks put it on screen. With `0042`, each click writes two rows straight to their final ranks, and the second swap waits for the first and then lands: ALF-4 reaches the bottom.

The browser half (ignoring a server copy of a story's rank while one of its swaps still awaits its response or its realtime echo) has no surface here without a live Supabase realtime channel. It is pinned by the `code-store` unit tests under *while a later swap of the same story is unsynced (ALF-250)*, and the row's queued swaps now flush on unmount (`backlog-row` tests).
