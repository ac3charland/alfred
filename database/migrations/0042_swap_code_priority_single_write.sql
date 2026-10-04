-- Alfred — The Backlog swap writes each row once, against ranks it has locked (ALF-250).
--
-- THE BUG. Nudging a story down the Backlog one chevron at a time made it snap to the top of the
-- list and slide back, and under repeated clicks the nudges stopped landing at all. Two defects in
-- `swap_code_priority` (last defined by 0014) fed it:
--
--   1. A transient row version every subscriber sees. The swap parked `p_a` on a sentinel
--      (`min(priority) - 1`, the top of the whole Backlog) before landing it on `p_b`'s rank. Each
--      of those writes is a row version `supabase_realtime` broadcasts, so every open Backlog
--      first received "this story is now FIRST" and only then its real rank — the snap to the
--      top. A click landing in between read its neighbour off that bogus order.
--   2. Unlocked reads. Both ranks were read with plain SELECTs. A second swap of the same story,
--      overlapping the first (the next chevron burst committing while the previous one is still
--      in flight), read the ranks from BEFORE the first committed and wrote a stale one back —
--      `duplicate key value violates unique constraint "code_items_priority_key"`, a 409 that
--      rolled the click back.
--
-- THE FIX. Read both ranks `for update` — in a fixed order, so two swaps can't deadlock — so an
-- overlapping swap waits for the first and then reads what it committed. And exchange them in
-- ONE update, so each row is written exactly once, straight to its final rank: no sentinel,
-- nothing transient to broadcast. 0031 made the unique check a DEFERRABLE constraint, and even
-- in its `initially immediate` mode a deferrable constraint is checked at the end of the
-- statement rather than per row — so the exchange needs no `set constraints`.
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
     set priority = case when ref = p_a then b_pri else a_pri end
   where ref in (p_a, p_b);
  return query select * from code_items where ref in (p_a, p_b);
end; $$;

grant execute on function swap_code_priority(text, text)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
