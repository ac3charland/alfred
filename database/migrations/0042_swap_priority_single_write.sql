-- Alfred — swap_code_priority writes each row once, with its final rank (ALF-250).
--
-- THE BUG. 0007/0014 swapped two ranks through a sentinel: park A one step above the whole
-- Backlog (`min(priority) - 1`), give B A's rank, then land A on B's. Realtime (0003) replays
-- every row write of the transaction, in order, so each Backlog chevron click published A at the
-- sentinel: the row jumped to the top of the list, then slid back down when its final write
-- arrived.
--
-- THE FIX. The sentinel existed only because the unique index was checked per row,
-- mid-statement. 0031 made `code_items_priority_key` a DEFERRABLE constraint, and even in its
-- immediate mode a deferrable unique constraint is checked at the END of each statement — so
-- the two ranks can be exchanged in one UPDATE, each row written once with its final value.
-- Both rows are locked first, in one statement ordered by ref, so a concurrent swap of either
-- (another tab) waits and then exchanges the ranks they hold after this one — and two swaps of
-- the same pair in opposite argument order lock in the same order instead of deadlocking.
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
  update code_items
     set priority = case ref when p_a then b_pri else a_pri end
   where ref in (p_a, p_b);
  return query select * from code_items where ref in (p_a, p_b);
end; $$;

grant execute on function swap_code_priority(text, text)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
