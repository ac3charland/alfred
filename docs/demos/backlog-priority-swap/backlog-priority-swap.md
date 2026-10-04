---
branch: alf-334/replay-250-medium-r3
---

# ALF-250: Backlog chevron swaps no longer snap back or jam

*2026-10-04T20:54:43.315Z*

Root cause, two halves. (1) The store synced each chevron burst independently and reconciled every step's server answer immediately — older than the optimistic screen, so the row snapped back up and tied with a neighbour (dead chevrons), and a second burst raced the first on the server. Bursts now share one queue, reconciled once it drains; realtime priority echoes are ignored meanwhile. (2) `swap_code_priority` parked a row at a sentinel rank (min-1), which realtime rendered as a jump to the top, and concurrent swaps all picked the same sentinel and 409'd. Migration 0042 swaps in one locked UPDATE.

Before (migration 0042 removed), the same script printed: rows written `ALF-3=-4  ALF-2=-3  ALF-3=-2` (the -4 sentinel is a top-of-list flash), and the overlapping swap failed with `duplicate key value violates unique constraint "code_items_priority_key"`. After, on a throwaway fully-migrated Postgres:

```bash
node docs/demos/backlog-priority-swap/swap-demo.ts 2>/dev/null
```

```output
start:             ALF-3=-3  ALF-2=-2  ALF-1=-1
rows written:      ALF-2=-3  ALF-3=-2
overlapping swap: ok
end:               ALF-1=-3  ALF-2=-2  ALF-3=-1
```
