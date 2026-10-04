-- Alfred — swap two Backlog ranks in ONE write, with no sentinel (ALF-250).
--
-- `swap_code_priority` (0007, re-declared in 0014) swapped through a sentinel: it parked story A
-- at `min(priority) - 1`, gave B A's rank, then gave A B's. Realtime broadcasts every one of those
-- row writes, so each open Backlog briefly received "A is now the top story of all" and drew it
-- there before the next event slid it back down — the jump-up-then-slide the single chevrons
-- showed on every nudge.
--
-- The sentinel only existed because the unique index was checked per row, mid-statement (the 0007
-- bug). Since 0031 it is a DEFERRABLE constraint, and Postgres checks a deferrable unique
-- constraint at the END of the statement even while it is `initially immediate` — so one CASE
-- update exchanging the two ranks is now legal, and it emits exactly the two final rows.
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

grant execute on function swap_code_priority(text, text)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
