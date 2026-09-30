-- Alfred — swap two stories' Backlog priority in ONE write per story (ALF-250).
--
-- THE BUG. 0014's `swap_code_priority` parks `p_a` on a sentinel (`min(priority) - 1`), moves
-- `p_b` into `p_a`'s old rank, then lands `p_a` on `p_b`'s. The sentinel only existed because
-- `code_items_priority_key` was a plain unique INDEX, checked per row mid-statement (the 0007
-- note). But `code_items` streams through Realtime (0003), which publishes every row change —
-- including the parked one. Every open Backlog was told, for one message, that the nudged story
-- ranked above everything, so a single-chevron nudge made the row leap to the top of the list and
-- slide back down.
--
-- THE FIX. 0031 made that uniqueness a DEFERRABLE constraint (`initially immediate`), which
-- Postgres checks at the END of each statement rather than per row. So the one-statement CASE swap
-- 0005 first tried — and 0007 replaced with the sentinel — now stands: each story is written once,
-- straight to its final rank, and that is all Realtime sees. Ordinary writes still fail fast on a
-- real duplicate; nothing here defers the check to commit.
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
