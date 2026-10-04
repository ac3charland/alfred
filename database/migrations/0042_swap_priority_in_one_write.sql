-- Alfred — swap_code_priority writes each row once, straight to its final rank (ALF-250).
--
-- THE BUG. 0014's swap (from 0007) parks the first story at a sentinel — `min(priority) - 1`,
-- one rank above the whole Backlog — before landing it on its new rank, because a plain unique
-- INDEX is checked per row mid-statement and a direct exchange would collide. Every UPDATE is
-- echoed over realtime, so the parking write reaches the browser as a real move: the swapped
-- story flashes to the TOP of the Backlog, then slides back down when the final write arrives
-- (the "single arrows jump back up and then slide down" the owner reported). A chevron click
-- landing in that window swaps from the parked position, not the one the user meant.
--
-- THE FIX. 0031 replaced the index with `unique (priority) deferrable initially immediate`. A
-- DEFERRABLE unique constraint — even an immediate one — is checked at the END of the statement,
-- not per row, so the one `case` UPDATE that 0007 had to avoid is now safe: both rows move in a
-- single statement, each written once, to its final rank. A real duplicate still fails at the
-- end of the statement, exactly as before. No sentinel, so nothing transient to echo.
create or replace function swap_code_priority(p_a text, p_b text)
returns setof code_items language plpgsql security invoker as $$
declare a_pri double precision; b_pri double precision;
begin
  -- Lock both rows first, in one statement and a fixed order (so swap(a, b) racing swap(b, a)
  -- queues instead of deadlocking): a concurrent swap sharing a story — another tab — waits for
  -- this one to commit, then reads the committed ranks rather than exchanging stale ones into a
  -- duplicate. Each read below takes a fresh snapshot, after the lock is held.
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

notify pgrst, 'reload schema';
