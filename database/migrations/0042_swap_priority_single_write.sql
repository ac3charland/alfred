-- Alfred — swap_code_priority writes each story once, at its final rank (ALF-250).
--
-- THE BUG. 0007/0009/0014 swap two ranks in three single-row UPDATEs, parking the first story at
-- a sentinel (`min(priority) - 1`) on the way, because the unique index was checked per row
-- mid-statement. Every UPDATE of `code_items` is broadcast over realtime and the Backlog applies
-- each one, so every chevron nudge broadcast the nudged story at the sentinel — the very top of
-- the Backlog — before its real rank: the row jumped up, then slid back down.
--
-- THE FIX. 0031 made `code_items_priority_key` DEFERRABLE, so the swap can now be the single
-- CASE update 0005 first wrote: defer the check to commit for this transaction, and each story
-- is written exactly once, at the rank it ends on.
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

grant execute on function swap_code_priority(text, text)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
