-- Alfred — the Backlog's chevron swap writes each row once, straight to its final rank (ALF-250).
--
-- `swap_code_priority` (0007, last redefined in 0014) dodged the unique(priority) index by first
-- PARKING p_a at `min(priority) - 1` — above every story in the Backlog — and only then trading
-- the two ranks. Realtime publishes every row UPDATE, so each nudge broadcast p_a at the very top
-- of the list before its real rank: an open Backlog showed the story jump up, then slide back
-- down. 0031 made the constraint DEFERRABLE, so the park is no longer needed: defer the check for
-- this transaction and swap both rows in ONE statement, each row written once with its final rank.
--
-- The two rows are also read `for update`, so overlapping swaps on a shared row run one after the
-- other against fresh ranks instead of each trading the ranks it read before the other committed.
create or replace function swap_code_priority(p_a text, p_b text)
returns setof code_items language plpgsql security invoker as $$
declare a_pri double precision; b_pri double precision;
begin
  -- Lock both rows in a fixed order (by ref) so two swaps sharing a row can't deadlock.
  perform 1 from code_items where ref in (p_a, p_b) order by ref for update;
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
