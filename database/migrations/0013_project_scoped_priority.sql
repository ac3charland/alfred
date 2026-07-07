-- Alfred — Bump to top/bottom of PROJECT, keep the existing top/bottom of LIST (ALF-110).
--
-- The Backlog row exposed one "jump" pair (double chevrons → `move_code_priority`, ALF-35/0009):
-- re-rank a story to the extreme of the WHOLE cross-project Backlog. ALF-110 splits that into two
-- distinct jumps — "top/bottom of the story's own PROJECT" (new) and "top/bottom of the whole
-- Backlog" (existing, unchanged RPC) — plus makes brand-new stories default to the top of their
-- project rather than the top of the whole Backlog.
--
-- A project-scoped jump has to insert the story BETWEEN two existing ranks (the project's current
-- best/worst story and whichever OTHER project's story sits just past it) without disturbing any
-- other row's rank. `priority` was `bigint` with no gaps to spare for that. Rather than renumber
-- every row on each move (expensive, and would tie up the whole table), this widens `priority` to
-- `double precision` and inserts at the MIDPOINT of the two bounding ranks — the numeric-order
-- analogue of a linked-list insert. No other row's priority ever changes. This is the same
-- fractional-key technique used by LexoRank/Notion-style ordered lists.
--
--   1. Widen `code_items.priority` to `double precision` (drop/recreate `v_code_stories`, which
--      pins the column's type, around the `ALTER`).
--   2. Recreate `swap_code_priority` / `move_code_priority` with `double precision` locals — same
--      logic, just no longer truncating a fractional priority back to an integer in transit.
--   3. `move_code_priority_in_project(ref, to_top)` — the new project-scoped jump.
--   4. `top_of_project_priority(project)` — the shared "insert at this project's top" math, used
--      by both the new RPC's to-top branch and the two creation RPCs below.
--   5. `create_code_story` / `enter_code_module` now default to the top of the story's PROJECT
--      (ALF-110), not the top of the whole Backlog (ALF-71).

-- ── 1. Widen priority to fractional ──────────────────────────────────────────
drop view v_code_stories;

alter table code_items alter column priority type double precision;
alter table code_items alter column priority set default nextval('code_priority_seq')::double precision;

comment on column code_items.priority is
  'Global cross-project Backlog rank (ALF-35). Lower = higher priority. Fractional (ALF-110): a '
  'project-scoped move inserts at the midpoint of two existing ranks so no other row is '
  'renumbered. Reordered by swap_code_priority()/move_code_priority()/'
  'move_code_priority_in_project(). Distinct across all stories.';

create view v_code_stories with (security_invoker = true) as
  select
    c.item_id, c.project_id, c.epic_id, c.ref_number, c.ref, c.factory_state, c.lane,
    c.spec_path, c.spec_sha, c.spec_markdown, c.refinement_pr_url, c.implementation_pr_url,
    c.blocked_reason, c.created_at as code_created_at, c.updated_at as code_updated_at,
    i.title, i.notes, i.source_url, i.created_at as item_created_at,
    p.key as project_key, p.name as project_name, p.repo_owner, p.repo_name,
    e.name as epic_name, e.ref as epic_ref, e.archived_at as epic_archived_at,
    c.priority
  from code_items c
  join items i on i.id = c.item_id
  join projects p on p.id = c.project_id
  join epics e on e.id = c.epic_id;

-- ── 2. Re-declare the existing RPCs' locals as double precision ─────────────
-- Unchanged logic — only the swap and either extreme, so integer arithmetic keeps working
-- exactly as before for stories that never took a fractional rank. `bigint` locals would
-- silently ROUND a fractional priority on read, corrupting a project-scoped position the moment
-- a plain reorder/list-jump touched that row afterward.
create or replace function swap_code_priority(p_a text, p_b text)
returns setof code_items language plpgsql security invoker as $$
declare a_pri double precision; b_pri double precision; sentinel double precision;
begin
  select priority into a_pri from code_items where ref = p_a;
  select priority into b_pri from code_items where ref = p_b;
  if a_pri is null or b_pri is null then
    raise exception 'swap_code_priority: unknown ref (% / %)', p_a, p_b;
  end if;
  select min(priority) - 1 into sentinel from code_items;
  update code_items set priority = sentinel where ref = p_a;
  update code_items set priority = a_pri where ref = p_b;
  update code_items set priority = b_pri where ref = p_a;
  return query select * from code_items where ref in (p_a, p_b);
end; $$;

grant execute on function swap_code_priority(text, text)
  to anon, authenticated, service_role;

create or replace function move_code_priority(p_ref text, p_to_top boolean)
returns setof code_items language plpgsql security invoker as $$
declare target_pri double precision; new_pri double precision;
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

-- ── 3. Shared "top of project" insertion math ────────────────────────────────
-- The priority that lands a story at the top of `p_project` WITHOUT displacing any other
-- project's stories that already rank better: the midpoint between the project's current best
-- rank and whichever OTHER project's row sits immediately above it. If the project's best story
-- is already the global best (no row above it), fall back to one step beyond it, exactly like
-- `move_code_priority`'s to-top branch. If the project has no rows yet, there is no project-
-- relative position to preserve, so it lands at the global top instead.
create or replace function top_of_project_priority(p_project uuid) returns double precision
language plpgsql security invoker as $$
declare v_best double precision; v_above double precision;
begin
  select min(priority) into v_best from code_items where project_id = p_project;
  if v_best is null then
    select coalesce(min(priority), 0) - 1 into v_best from code_items;
    return v_best;
  end if;
  select max(priority) into v_above from code_items where priority < v_best;
  if v_above is null then
    return v_best - 1;
  end if;
  return (v_above + v_best) / 2.0;
end; $$;

grant execute on function top_of_project_priority(uuid)
  to anon, authenticated, service_role;

-- ── 4. Project-scoped jump: "top/bottom of project" ─────────────────────────
-- Mirrors `move_code_priority`, but the extreme is computed over the story's OWN PROJECT rather
-- than the whole Backlog, and the insertion point is the midpoint against the nearest row from
-- ANY project that already ranks past that extreme — so other projects keep their relative order.
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
    select min(priority) into v_extreme
      from code_items where project_id = v_project and ref <> p_ref;
    if v_extreme is null then
      -- The only story in its project — there's no project-relative position to preserve, so
      -- jump it to the top of the whole Backlog (matching `top_of_project_priority`'s fallback).
      select coalesce(min(priority), 0) - 1 into v_new from code_items where ref <> p_ref;
    else
      select max(priority) into v_neighbour
        from code_items where priority < v_extreme and ref <> p_ref;
      v_new := case when v_neighbour is null then v_extreme - 1
                    else (v_neighbour + v_extreme) / 2.0 end;
    end if;
  else
    select max(priority) into v_extreme
      from code_items where project_id = v_project and ref <> p_ref;
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

-- ── 5. New stories default to the top of THEIR PROJECT, not the whole Backlog ──────────────────
create or replace function create_code_story(
  p_project uuid, p_epic uuid, p_title text, p_notes text default null
) returns code_items language plpgsql security invoker as $$
declare n int; k text; v_item uuid; v_priority double precision; row code_items;
begin
  select key into k from projects where id = p_project;
  n := next_code_ref(p_project);
  -- ALF-110: land at the top of the story's own project, not the whole Backlog.
  v_priority := top_of_project_priority(p_project);
  insert into items (title, notes, item_type)
  values (p_title, p_notes, 'code')
  returning id into v_item;
  insert into code_items (item_id, project_id, epic_id, ref_number, ref, priority)
  values (v_item, p_project, p_epic, n, k || '-' || n, v_priority) returning * into row;
  return row;
end; $$;

grant execute on function create_code_story(uuid, uuid, text, text)
  to anon, authenticated, service_role;

create or replace function enter_code_module(p_item uuid, p_project uuid, p_epic uuid)
returns code_items language plpgsql security invoker as $$
declare n int; k text; v_priority double precision; row code_items;
begin
  select key into k from projects where id = p_project;
  n := next_code_ref(p_project);
  -- ALF-110: land at the top of the item's own project, not the whole Backlog.
  v_priority := top_of_project_priority(p_project);
  update items set item_type = 'code', due_date = null, parent_id = null,
                   status = 'active', completed_at = null
    where id = p_item;
  insert into code_items (item_id, project_id, epic_id, ref_number, ref, priority)
  values (p_item, p_project, p_epic, n, k || '-' || n, v_priority) returning * into row;
  return row;
end; $$;

grant execute on function enter_code_module(uuid, uuid, uuid)
  to anon, authenticated, service_role;
