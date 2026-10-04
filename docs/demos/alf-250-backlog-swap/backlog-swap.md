---
branch: alf-334/replay-250-medium-r2
---

# Backlog chevron swaps: no jump to the top, no out-of-order bursts

*2026-10-04T20:54:09.165Z*

ALF-250: clicking Down on a Backlog story made it jump to the top of the list and slide back, and rapid clicks could scramble the ranking until the single arrows stopped working. Two causes, one per side of the wire.

**Server.** `swap_code_priority` parked one row on a sentinel rank one step above the whole Backlog before landing it. Realtime replays every row write of a transaction in order, so the browser rendered that sentinel: the story jumped to the top, then slid down when its final write arrived. Migration 0042 exchanges the two ranks in one UPDATE under the (already deferrable) unique constraint, so each row is written once, with its final rank. The script below runs one Down click against a throwaway Postgres without and with 0042, logging every write realtime would publish.

```bash
node docs/demos/alf-250-backlog-swap/reproduce.mjs
```

```output

── without 0042 (production) ──
  Backlog:       ALF-3=-3  ALF-2=-2  ALF-1=-1
  Down on ALF-2 → swap_code_priority('ALF-2', 'ALF-1')
  write 1: ALF-2 → -4
  write 2: ALF-1 → -2
  write 3: ALF-2 → -1
  Backlog:       ALF-3=-3  ALF-1=-2  ALF-2=-1

── with 0042 ──
  Backlog:       ALF-3=-3  ALF-2=-2  ALF-1=-1
  Down on ALF-2 → swap_code_priority('ALF-2', 'ALF-1')
  write 1: ALF-1 → -2
  write 2: ALF-2 → -1
  Backlog:       ALF-3=-3  ALF-1=-2  ALF-2=-1
```

Without 0042, write 1 puts ALF-2 at -4 — above ALF-3, the top of the Backlog — which is the "jumps up, then slides down" the owner saw on every single-arrow click. With 0042 the only writes are the two final ranks.

**Client.** Each Backlog row debounces its clicks into a burst and syncs it when the clicks settle — but a second burst's sync started while the first was still in flight. The swap RPC exchanges whatever ranks the rows hold *when it runs*, so ALF-1↔ALF-4 reaching the server before ALF-1↔ALF-3 scrambled the ranking for good, and two concurrent swaps of the same row could 409 and roll back onto stale ranks (equal ranks locally, so Down swapped two equal values and did nothing). The code store now runs every priority write (swap, jump, project jump) through one serial queue, and while that queue is busy a server response or realtime echo no longer overwrites a newer optimistic rank; the last write to settle reconciles it. Pinned by the `overlapping bursts (ALF-250)` tests in `frontend/lib/stores/code-store.test.tsx`; the filtered (project) view was a red herring — it only changes which neighbour a click swaps with.
