-- Alfred — The Backlog's single-chevron swap writes only final ranks, under row locks (ALF-250).
--
-- Two defects in `swap_code_priority` (last defined by 0014), both behind "the arrows jump back
-- up, then stop working":
--
-- 1. A TRANSIENT RANK. The swap parked p_a at `min(priority) - 1` before landing it, because the
--    unique index was checked per row mid-statement (0007). Every row version a swap writes is a
--    realtime UPDATE an open Backlog applies, so the parked rank — the top of the whole Backlog —
--    reached the browser and flashed the nudged story to the top before it slid back. 0031 made
--    `code_items_priority_key` a DEFERRABLE constraint, and Postgres checks a deferrable unique
--    constraint at the END of each statement even while it is immediate, so a single UPDATE can
--    now exchange the two ranks directly: one write per row, each its final value.
--
-- 2. AN UNLOCKED READ. Both ranks were read with plain SELECTs, so a second swap of the same
--    story (the next burst of clicks syncing while the previous one is still committing) read
--    the ranks as they stood BEFORE the first swap committed, then wrote one of them onto the
--    row that now holds it: `duplicate key value violates unique constraint
--    "code_items_priority_key"` → 409, rolled back, and the browser's copy left out of step.
--    Lock both rows first — in ref order, so two swaps over the same pair can't deadlock — and
--    read the ranks only once the lock is held, so concurrent swaps of one story serialise.
create or replace function swap_code_priority(p_a text, p_b text)
returns setof code_items language plpgsql security invoker as $$
declare a_pri double precision; b_pri double precision;
begin
  perform 1 from code_items where ref in (p_a, p_b) order by ref for update;
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

grant execute on function swap_code_priority(text, text)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
