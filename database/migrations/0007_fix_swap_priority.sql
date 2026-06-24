-- Alfred — Fix swap_code_priority's transient unique-constraint violation (ALF-35).
--
-- BUG: the chevron reorder failed with
--   409: duplicate key value violates unique constraint "code_items_priority_key"
--
-- WHY: 0005 swapped two rows' priority in ONE `update ... set priority = case ... end`
-- statement, assuming "one statement = no transient duplicate". That is FALSE for a plain
-- (non-deferrable) unique index: Postgres checks uniqueness PER ROW as each row is updated,
-- mid-statement. So when the UPDATE rewrites row A to B's priority while row B still holds it,
-- the index momentarily sees two equal values and rejects the whole statement.
--
-- FIX: swap via a temporary out-of-range value so EVERY per-row assignment lands on a priority
-- no live row holds. Priorities come from code_priority_seq and are always positive, so a row's
-- own negated priority is a collision-free parking spot. Three single-row updates, each unique
-- on its own, replace the one CASE update — no schema change, the existing immediate unique
-- index stays. (The textbook alternative is a DEFERRABLE INITIALLY DEFERRED unique CONSTRAINT,
-- which would let the single CASE update stand; the sentinel keeps the constraint immediate.)
create or replace function swap_code_priority(p_a text, p_b text)
returns setof code_items language plpgsql security invoker as $$
declare a_pri bigint; b_pri bigint;
begin
  select priority into a_pri from code_items where ref = p_a;
  select priority into b_pri from code_items where ref = p_b;
  if a_pri is null or b_pri is null then
    raise exception 'swap_code_priority: unknown ref (% / %)', p_a, p_b;
  end if;
  -- Park p_a at a negative sentinel (no live row is negative), vacating a_pri…
  update code_items set priority = -a_pri where ref = p_a;
  -- …give it to p_b (a_pri is now free)…
  update code_items set priority = a_pri where ref = p_b;
  -- …and land p_a on b_pri (now vacated by p_b). Each step is unique on its own.
  update code_items set priority = b_pri where ref = p_a;
  return query select * from code_items where ref in (p_a, p_b);
end; $$;

grant execute on function swap_code_priority(text, text)
  to anon, authenticated, service_role;
