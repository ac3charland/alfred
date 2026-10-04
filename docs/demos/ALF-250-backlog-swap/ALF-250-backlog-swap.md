---
branch: alf-334/replay-250-medium-r1
---

# ALF-250: Backlog chevron swaps no longer snap back or stall

*2026-10-04T18:38:54.317Z*

Reproduced: two Down clicks on ALF-1 in [ALF-1..ALF-4] queue two swaps. When the FIRST swap's reply landed it rewrote ALF-1's priority back to its post-step-one value while the second swap was still in flight — ALF-1 snapped back above ALF-3 and the two tied at the same priority. A Down click in that window swapped two equal priorities (no movement), and the queued server swap then moved ALF-1 back UP. Separately, swap_code_priority parked ALF-1 at a min(priority)-1 sentinel mid-swap; realtime broadcast that write, so every open Backlog flashed the story to the very top before sliding it down. Fixes: commitReorderBatch only applies a reply's priority when the server disagrees with the step's prediction; migration 0042 swaps in one CASE update (legal since the unique constraint became deferrable in 0031), so realtime only ever sees the two final ranks.

```bash
sed -n '/create or replace function swap_code_priority/,/end; \$\$;/p' database/migrations/0042_swap_priority_without_sentinel.sql
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
  return query
    update code_items
       set priority = case ref when p_a then b_pri else a_pri end
     where ref in (p_a, p_b)
    returning *;
end; $$;
```

Review round: the same rewind also arrived through realtime — step one's echo landed while step two was still unconfirmed. The store now records the ranks its own swaps write (ownRankWritesRef) and consumes their echoes instead of applying them, while another tab's reorder still lands. Reorder batches also run through one store-wide queue, so overlapping bursts reach the server in click order and every reply confirms the ranks the client predicted.
