-- Alfred — the Backlog's chevron swap writes each story once, and serializes (ALF-250).
--
-- THE BUG. `swap_code_priority` (0007, re-typed in 0014) exchanged two ranks in three UPDATEs,
-- parking the first story at a sentinel (`min(priority) - 1`) so the `unique(priority)` index never
-- saw a duplicate mid-swap. Two problems:
--
--   1. The sentinel is a real committed write the Backlog's realtime subscription renders: every
--      swap flashed the story to the very TOP of the list before it slid back down.
--   2. It read both ranks without a row lock, and every concurrent swap picked the SAME sentinel.
--      Two swaps sharing a story (a second chevron burst syncing while the first is still in
--      flight, or two tabs) therefore collided on the index — a 409 that rolled the client back
--      onto ranks the other swap had already changed.
--
-- THE FIX. Since 0031 the unique constraint is DEFERRABLE (initially immediate), and Postgres
-- checks a deferrable unique constraint at the END of each statement rather than per row — so one
-- UPDATE can trade the two ranks with no sentinel. Both rows are locked first (`for update`, in
-- ref order so two swaps can't deadlock), so a concurrent swap waits and then reads the ranks the
-- first one left behind.

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
       set priority = case when ref = p_a then b_pri else a_pri end
     where ref in (p_a, p_b)
    returning *;
end; $$;

grant execute on function swap_code_priority(text, text)
  to anon, authenticated, service_role;
