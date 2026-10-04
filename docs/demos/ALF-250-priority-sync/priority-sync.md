---
branch: alf-334/replay-250-medium-r5
---

# ALF-250: Backlog priority nudges land where you clicked

*2026-10-04T20:55:52.919Z*

**Before:** every Backlog row kept its own debounced queue of chevron swaps and flushed it independently, so two rows' clicks (or a second burst while the first was in flight) reached the server out of click order or overlapping. A swap exchanges the two rows' *current* server ranks, so a reordered replay lands the list somewhere the screen never showed. Meanwhile each earlier swap's response and every realtime echo was patched straight over the newer optimistic rank (the row 'snapped back up, then slid down'), and the swap RPC parked the row at a sentinel rank below everything, which realtime broadcast as a jump to the very top of the Backlog. A click on that stale order then swapped the wrong pair.

**After:** one store-level queue (`PrioritySync`) takes every ranking write from any row (and the story modal) in click order, sends them one at a time once clicks settle, and ignores server priorities for a story that still has a write pending — and realtime echoes of the tab's own writes. The script below drives the real class against a fake server: three clicks across two rows go out in click order, never overlapping; a stale echo is held; an external change still applies.

```bash
node --no-warnings --experimental-transform-types docs/demos/ALF-250-priority-sync/simulate.mts
```

```output
Clicks: ALF-238 down, RLP-1 up, ALF-238 down — two rows, inside one 200ms window
echo for ALF-238 while its writes are pending → apply priority? false
→ swap ALF-238↔ALF-192  (requests in flight: 1)
← swap ALF-238↔ALF-192 done
  patch ALF-238: priority held (later write pending)
→ swap RLP-1↔ALF-238  (requests in flight: 1)
← swap RLP-1↔ALF-238 done
  patch RLP-1: priority applied
→ swap ALF-238↔RLP-2  (requests in flight: 1)
← swap ALF-238↔RLP-2 done
  patch ALF-238: priority applied
echo of this tab's own write (ALF-238 @ 2) after the queue drained → apply? false
external change (ALF-238 @ 42, e.g. another device) → apply? true
```

**Database:** `0042_swap_priority_single_write.sql` swaps both ranks in one `UPDATE … CASE` under the deferred unique constraint (deferrable since 0031), so each story is written — and broadcast — exactly once, at its final rank. The new body:

```bash
sed -n '/^create or replace function/,/^end; \$\$;/p' database/migrations/0042_swap_priority_single_write.sql
```

```output
create or replace function swap_code_priority(p_a text, p_b text)
returns setof code_items language plpgsql security invoker as $$
declare a_pri double precision; b_pri double precision;
begin
  select priority into a_pri from code_items where ref = p_a;
  select priority into b_pri from code_items where ref = p_b;
  if a_pri is null or b_pri is null then
    raise exception 'swap_code_priority: unknown ref (% / %)', p_a, p_b;
  end if;
  -- For THIS transaction only; the uniqueness check still runs, at commit.
  set constraints code_items_priority_key deferred;
  return query
    update code_items
       set priority = case when ref = p_a then b_pri else a_pri end
     where ref in (p_a, p_b)
     returning *;
end; $$;
```
