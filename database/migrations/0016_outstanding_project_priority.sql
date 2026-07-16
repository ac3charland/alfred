-- Alfred — "Top/bottom of project" means the project's OUTSTANDING stories only (ALF-120).
--
-- ALF-110 (0014) made a new story default to the top of its PROJECT and repurposed the
-- double-chevron jump to "top/bottom of project", both computing the project's extreme as
-- min/max(priority) over EVERY story in the project. But a `done`/`abandoned` story keeps its
-- priority, and because new stories are stamped ever-more-negative (top-of-Backlog since ALF-71),
-- a project's most-negative rank is frequently held by a COMPLETED story sitting at/near the
-- global top. `top_of_project_priority` then found that completed story as the project's "top",
-- saw nothing above it, and returned `min - 1` — landing the new story at the global top of the
-- WHOLE Backlog, above other projects' outstanding work. That's the "code items always coming in
-- at top priority rather than top priority for project" bug.
--
-- Fix: compute the project's extreme over OUTSTANDING stories only (state not in
-- done/abandoned) — the same set the Backlog shows — so a new/bumped story lands next to the
-- project's top/bottom VISIBLE story. The "neighbour" midpoint anchor still ranges over ALL
-- stories (any project, any status) so the inserted priority never collides with a hidden row.
-- The no-outstanding-anchor fallback is unchanged: a project with no visible story has no
-- project-relative position, so it lands at the global top (matching ALF-110).
--
-- create_code_story / enter_code_module call top_of_project_priority() by name, so replacing the
-- helper fixes both creation paths without recreating them.
--
-- move_code_priority_in_project was last re-asserted by 0015 (ALF-119) to expose it through the
-- PostgREST schema cache, and 0015 attached a comment the integration suite checks. This `create
-- or replace` keeps the function's identity (same (text, boolean) signature), so that ALF-119
-- comment survives untouched; only the body changes to the outstanding-scoped one below.

-- ── Creation default: top of the project's OUTSTANDING stories ────────────────
create or replace function top_of_project_priority(p_project uuid) returns double precision
language plpgsql security invoker as $$
declare v_best double precision; v_above double precision;
begin
  -- ALF-120: the project's top OUTSTANDING rank, ignoring done/abandoned (which stay in the
  -- table with their old priorities but are hidden from the Backlog the user reasons about).
  select min(priority) into v_best
    from code_items
    where project_id = p_project and factory_state not in ('done', 'abandoned');
  if v_best is null then
    -- No outstanding story to anchor to — no project-relative position, so land at the global top.
    select coalesce(min(priority), 0) - 1 into v_best from code_items;
    return v_best;
  end if;
  -- The nearest priority above the project's top (ANY project, ANY status) — the midpoint with it
  -- lands the new story just above the project's top VISIBLE story without colliding with a hidden
  -- row that might sit between.
  select max(priority) into v_above from code_items where priority < v_best;
  if v_above is null then
    return v_best - 1;
  end if;
  return (v_above + v_best) / 2.0;
end; $$;

grant execute on function top_of_project_priority(uuid)
  to anon, authenticated, service_role;

-- ── Project-scoped jump: top/bottom of the project's OUTSTANDING stories ──────
create or replace function move_code_priority_in_project(p_ref text, p_to_top boolean)
returns setof code_items language plpgsql security invoker as $$
declare
  v_project uuid; v_extreme double precision; v_neighbour double precision; v_new double precision;
begin
  select project_id into v_project from code_items where ref = p_ref;
  if v_project is null then
    raise exception 'move_code_priority_in_project: unknown ref (%)', p_ref;
  end if;

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
      v_new := case when v_neighbour is null then v_extreme - 1
                    else (v_neighbour + v_extreme) / 2.0 end;
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
      v_new := case when v_neighbour is null then v_extreme + 1
                    else (v_neighbour + v_extreme) / 2.0 end;
    end if;
  end if;

  return query
    update code_items set priority = v_new where ref = p_ref returning *;
end; $$;

grant execute on function move_code_priority_in_project(text, boolean)
  to anon, authenticated, service_role;
