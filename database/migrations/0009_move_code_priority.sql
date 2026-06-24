-- Alfred — Bump a story to the top or bottom of the global Backlog (ALF-47).
--
-- The chevron swap (swap_code_priority) only trades ranks with the adjacent neighbour. This
-- adds the double-chevron "jump to top / bottom" the Backlog rows expose: re-rank ONE story to
-- just beyond the current extreme in a single atomic UPDATE.
--   1. move_code_priority(p_ref, p_to_top) — the jump RPC
--   2. swap_code_priority hardened so its sentinel survives non-positive priorities

-- ── 1. Jump-to-extreme RPC ───────────────────────────────────────────────────
-- Re-rank p_ref to one step beyond the current extreme: min(priority)-1 to send it to the TOP
-- (lower = higher priority), max(priority)+1 to send it to the BOTTOM. A single-row UPDATE to a
-- value no live row holds (it is strictly outside the current range), so the immediate
-- unique(priority) index never sees a transient duplicate — no sentinel dance needed, unlike the
-- swap. Returns the updated row. `security invoker` so RLS still applies (matching the 0005/0007
-- RPCs). Excludes p_ref itself from the extreme so a no-op jump (already at the end) is stable.
create or replace function move_code_priority(p_ref text, p_to_top boolean)
returns setof code_items language plpgsql security invoker as $$
declare target_pri bigint; new_pri bigint;
begin
  select priority into target_pri from code_items where ref = p_ref;
  if target_pri is null then
    raise exception 'move_code_priority: unknown ref (%)', p_ref;
  end if;
  if p_to_top then
    select coalesce(min(priority), 0) - 1 into new_pri from code_items where ref <> p_ref;
  else
    select coalesce(max(priority), 0) + 1 into new_pri from code_items where ref <> p_ref;
  end if;
  return query
    update code_items set priority = new_pri where ref = p_ref returning *;
end; $$;

grant execute on function move_code_priority(text, boolean)
  to anon, authenticated, service_role;

-- ── 2. Make the swap sentinel sign-safe ──────────────────────────────────────
-- 0007 parked p_a at `-a_pri`, relying on "no live row is negative". move_code_priority breaks
-- that premise: jump-to-top lands stories on 0, then negatives, so a later swap of a row at -v
-- against a row at v would park it at -(-v)=v and collide. Park instead at `min(priority)-1`
-- across ALL rows — strictly below every live priority, so it is always free, whatever the signs.
create or replace function swap_code_priority(p_a text, p_b text)
returns setof code_items language plpgsql security invoker as $$
declare a_pri bigint; b_pri bigint; sentinel bigint;
begin
  select priority into a_pri from code_items where ref = p_a;
  select priority into b_pri from code_items where ref = p_b;
  if a_pri is null or b_pri is null then
    raise exception 'swap_code_priority: unknown ref (% / %)', p_a, p_b;
  end if;
  select min(priority) - 1 into sentinel from code_items;
  -- Park p_a below every live priority (guaranteed free), vacating a_pri…
  update code_items set priority = sentinel where ref = p_a;
  -- …give it to p_b (a_pri is now free)…
  update code_items set priority = a_pri where ref = p_b;
  -- …and land p_a on b_pri (now vacated by p_b). Each step is unique on its own.
  update code_items set priority = b_pri where ref = p_a;
  return query select * from code_items where ref in (p_a, p_b);
end; $$;

grant execute on function swap_code_priority(text, text)
  to anon, authenticated, service_role;
