-- Alfred — the Backlog rank respaces itself when it runs out of floating-point room.
--
-- THE OUTAGE. Every code dispatch (`enter_code_module`), every new story (`create_code_story`)
-- and every epic conversion (`convert_to_code_epic`) asks `top_of_project_priority` where to
-- land, and it answers with the MIDPOINT of two existing ranks (0014, refined by 0016). A
-- midpoint halves the gap it lands in, so N dispatches into the same project halve the same gap
-- N times. `code_items.priority` is `double precision`: after roughly fifty halvings the two
-- bounding ranks are ADJACENT doubles, there is no representable value between them, and
-- `(v_above + v_best) / 2.0` rounds onto one of the bounds it was supposed to separate.
-- `code_items_priority_key` then rejects the insert:
--
--     duplicate key value violates unique constraint "code_items_priority_key"
--
-- which PostgREST answers as 409. Production reached that point in the Alfred project: `v_best`
-- and `v_above` were adjacent doubles around -158.999999014483, so EVERY code dispatch failed
-- while task dispatch (a plain `dispatched_at` PATCH, which never touches this column) kept
-- working. It is permanent rather than intermittent — the failed transaction rolls back, so the
-- next attempt recomputes the same collision forever.
--
-- THE FIX. Fractional ranking without renormalisation is a bounded resource pretending to be an
-- unbounded one. Give it the renormalisation it was always missing: when the midpoint would
-- collide, respace every rank to consecutive integers — order preserved, gaps restored — and
-- compute again against neighbours a whole integer apart. Self-healing, and in the database
-- rather than in a route, because three RPCs and a Worker all reach this column and only the
-- database sits under all of them (the same argument 0026 and 0029 make for their triggers).
--
-- The unique index is NOT the bug — it is the smoke alarm. Without it the collision would have
-- landed two stories on one rank and the Backlog would have ordered them arbitrarily, which is
-- far harder to notice than a 409. It stays.

-- ── 1. The unique index becomes a DEFERRABLE constraint ──────────────────────
-- A respace rewrites every rank in one statement, and a plain unique INDEX is checked per row
-- MID-statement (the 0007 swap bug — see the supabase skill), so the rewrite would trip over a
-- rank another row still holds. A deferrable CONSTRAINT can be checked at commit instead. A bare
-- `create unique index` can never be deferrable, so 0005's index is replaced by a constraint of
-- the same name.
--
-- `initially immediate`, not `initially deferred`: ordinary writes keep failing fast on a real
-- duplicate, exactly as they do today. Only `respace_code_priorities` defers, and only for its
-- own transaction.
drop index code_items_priority_key;

alter table code_items
  add constraint code_items_priority_key unique (priority) deferrable initially immediate;

-- `setval` needs UPDATE on the sequence — USAGE (0008) only covers `nextval`/`currval`. The
-- respace runs as whoever dispatched, including the `authenticated` role a browser uses, so
-- without this the renormalisation 500s on its last statement.
grant update on sequence code_priority_seq
  to anon, authenticated, service_role;

-- ── 2. The renormalisation ───────────────────────────────────────────────────
-- Rewrite every rank to 1..N in the order they already stand. A renumbering, never a reordering:
-- `order by priority` is total (the unique constraint guarantees no ties), so the output order is
-- the input order and no story changes position in the Backlog.
create or replace function respace_code_priorities() returns void
language plpgsql security invoker as $$
begin
  -- For THIS transaction only; the check still runs, at commit.
  set constraints code_items_priority_key deferred;
  update code_items c
     set priority = ranked.rn
    from (select item_id, row_number() over (order by priority) as rn from code_items) as ranked
   where ranked.item_id = c.item_id;
  -- Park the sequence above the new top rank. The column default (`nextval`, 0005) is the
  -- fallback for an insert that names no priority; leaving the sequence where it was would let
  -- one collide with a respaced rank once the table outgrows it (the RPCs add rows without
  -- advancing it, so the row count can and does overtake the sequence).
  perform setval('code_priority_seq', (select max(priority)::bigint from code_items) + 1, false);
end; $$;

comment on function respace_code_priorities() is
  'Rewrite every code_items.priority to consecutive integers 1..N, preserving the current '
  'Backlog order, and park code_priority_seq above them. Called by the ranking RPCs when a '
  'midpoint would collide with the bound it was meant to separate — i.e. when double precision '
  'has run out of room between two adjacent ranks.';

grant execute on function respace_code_priorities()
  to anon, authenticated, service_role;

-- ── 3. The creation default, now respacing when it must ──────────────────────
-- Body copied from 0016 (the migration that last defined it) with only the exhaustion guard
-- added — re-deriving from an older migration silently reverts later fixes (0025's trap).
--
-- Two passes at most: after a respace the neighbours are consecutive integers, so their midpoint
-- is a clean `k + 0.5` and cannot collide. A second failure would mean the respace itself is
-- broken, so it raises rather than looping.
create or replace function top_of_project_priority(p_project uuid) returns double precision
language plpgsql security invoker as $$
declare v_best double precision; v_above double precision; v_new double precision; v_pass int;
begin
  for v_pass in 1..2 loop
    -- ALF-120: the project's top OUTSTANDING rank, ignoring done/abandoned (which stay in the
    -- table with their old priorities but are hidden from the Backlog the user reasons about).
    select min(priority) into v_best
      from code_items
      where project_id = p_project and factory_state not in ('done', 'abandoned');
    if v_best is null then
      -- No outstanding story to anchor to — no project-relative position, so land at the global
      -- top. Subtracting one can never collide, so this branch needs no guard.
      select coalesce(min(priority), 0) - 1 into v_best from code_items;
      return v_best;
    end if;
    -- The nearest priority above the project's top (ANY project, ANY status) — the midpoint with
    -- it lands the new story just above the project's top VISIBLE story without colliding with a
    -- hidden row that might sit between.
    select max(priority) into v_above from code_items where priority < v_best;
    if v_above is null then
      return v_best - 1;
    end if;
    v_new := (v_above + v_best) / 2.0;
    exit when v_new <> v_above and v_new <> v_best;
    if v_pass = 2 then
      raise exception 'top_of_project_priority: ranks still exhausted after respacing';
    end if;
    perform respace_code_priorities();
  end loop;
  return v_new;
end; $$;

grant execute on function top_of_project_priority(uuid)
  to anon, authenticated, service_role;

-- ── 4. The project-scoped jump, same guard ───────────────────────────────────
-- The reorder twin: the double-chevron midpoints against the same two bounds, so it hits the
-- same wall. Body copied from 0016 with the guard added; the respace moves the target row's own
-- rank too, which is why the second pass re-reads every bound rather than reusing the first.
create or replace function move_code_priority_in_project(p_ref text, p_to_top boolean)
returns setof code_items language plpgsql security invoker as $$
declare
  v_project uuid; v_extreme double precision; v_neighbour double precision; v_new double precision;
  v_pass int; v_midpoint boolean;
begin
  select project_id into v_project from code_items where ref = p_ref;
  if v_project is null then
    raise exception 'move_code_priority_in_project: unknown ref (%)', p_ref;
  end if;

  for v_pass in 1..2 loop
    -- `v_midpoint` records whether this pass actually took a midpoint: the "no peer" branches
    -- step a whole 1 away from an extreme and can never collide, so only the midpoint needs the
    -- exhaustion check below.
    v_midpoint := false;
    if p_to_top then
      -- ALF-120: extreme over the project's OUTSTANDING stories only (exclude done/abandoned).
      select min(priority) into v_extreme
        from code_items
        where project_id = v_project and ref <> p_ref
          and factory_state not in ('done', 'abandoned');
      if v_extreme is null then
        select coalesce(min(priority), 0) - 1 into v_new from code_items where ref <> p_ref;
      else
        select max(priority) into v_neighbour
          from code_items where priority < v_extreme and ref <> p_ref;
        if v_neighbour is null then
          v_new := v_extreme - 1;
        else
          v_new := (v_neighbour + v_extreme) / 2.0;
          v_midpoint := true;
        end if;
      end if;
    else
      select max(priority) into v_extreme
        from code_items
        where project_id = v_project and ref <> p_ref
          and factory_state not in ('done', 'abandoned');
      if v_extreme is null then
        select coalesce(max(priority), 0) + 1 into v_new from code_items where ref <> p_ref;
      else
        select min(priority) into v_neighbour
          from code_items where priority > v_extreme and ref <> p_ref;
        if v_neighbour is null then
          v_new := v_extreme + 1;
        else
          v_new := (v_neighbour + v_extreme) / 2.0;
          v_midpoint := true;
        end if;
      end if;
    end if;
    exit when not v_midpoint or (v_new <> v_neighbour and v_new <> v_extreme);
    if v_pass = 2 then
      raise exception 'move_code_priority_in_project: ranks still exhausted after respacing';
    end if;
    perform respace_code_priorities();
  end loop;

  return query
    update code_items set priority = v_new where ref = p_ref returning *;
end; $$;

grant execute on function move_code_priority_in_project(text, boolean)
  to anon, authenticated, service_role;

-- ── 5. Normalise what production is already carrying ─────────────────────────
-- The guard above only fires on the NEXT allocation; the ranks already crushed together stay
-- crushed until something respaces them. Do it here, so the database each instance ends up with
-- has room again the moment this migration lands rather than one dispatch later.
select respace_code_priorities();

notify pgrst, 'reload schema';
