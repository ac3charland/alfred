-- Alfred — a Backlog nudge writes each story once, straight to its final rank (ALF-250).
--
-- THE BUG. `swap_code_priority` (0007, re-declared by 0014) swaps two ranks in three single-row
-- UPDATEs, parking the first story at `min(priority) - 1` — the top of the whole Backlog — so
-- that no write collides with `unique(priority)`. Realtime streams every row-level UPDATE, not
-- just each row's end state, so the browser receives that parking write as a real rank: on every
-- single-chevron nudge the story flashed to the top of the list, then slid back down when the
-- third write's echo landed. And because the two ranks were read with plain SELECTs, two swaps of
-- the same story in flight at once (two quick nudges, or two tabs) let the second one read the
-- ranks from before the first committed: it handed its neighbour a rank the first swap had
-- already given away, and 409'd on the unique constraint.
--
-- THE FIX. 0031 made `code_items_priority_key` a DEFERRABLE (initially immediate) constraint, and
-- Postgres checks a deferrable unique constraint at the END of each statement rather than per
-- row. So the swap is now ONE UPDATE that exchanges both ranks — no parking rank, no transient
-- write — after locking both rows (in ref order, so two opposing swaps can't deadlock) so a
-- concurrent swap waits for this one and then reads the ranks it left.
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

notify pgrst, 'reload schema';
