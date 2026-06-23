-- ALF-45 — Recurring tasks: Phase 0 schema & types
--
-- Adds recurrence metadata to `items`, an index for series grouping, and the
-- complete_and_spawn RPC. Recreates get_subtree / complete_subtree so both
-- compile against the updated items row type.

-- ── Schema additions ──────────────────────────────────────────────────────────
alter table items
  add column recurrence jsonb,
  add column recurrence_series_id uuid,
  add column occurrence_index int;

-- Index for series grouping (Completed view + future "edit this and future").
create index items_recurrence_series_id_idx on items (recurrence_series_id);

-- ── Recreate get_subtree with recurrence columns ──────────────────────────────
-- Must DROP first: CREATE OR REPLACE cannot change an existing function's return type.
drop function if exists get_subtree(uuid);
create or replace function get_subtree(root_id uuid)
returns table (
  id uuid,
  title text,
  notes text,
  source_url text,
  item_type item_type,
  created_at timestamptz,
  raw_capture text,
  due_date timestamptz,
  status item_status,
  completed_at timestamptz,
  folder_id uuid,
  parent_id uuid,
  recurrence jsonb,
  recurrence_series_id uuid,
  occurrence_index int,
  depth int
)
language sql
stable
security invoker
as $$
  with recursive subtree as (
    select i.*, 0 as depth
    from items i
    where i.id = root_id

    union all

    select c.*, s.depth + 1
    from items c
    inner join subtree s on c.parent_id = s.id
    where s.depth < 50
  )
  select id, title, notes, source_url, item_type, created_at, raw_capture,
         due_date, status, completed_at, folder_id, parent_id,
         recurrence, recurrence_series_id, occurrence_index, depth
  from subtree
  order by depth, created_at;
$$;

-- ── Recreate complete_subtree against the updated items row type ──────────────
create or replace function complete_subtree(root_id uuid)
returns setof items
language sql
security invoker
as $$
  with recursive subtree as (
    select id, 0 as depth from items where id = root_id
    union all
    select c.id, s.depth + 1 from items c
    inner join subtree s on c.parent_id = s.id
    where s.depth < 50
  )
  update items
  set status = 'completed', completed_at = now()
  where id in (select id from subtree)
  returning *;
$$;

-- ── Atomic complete-and-spawn RPC ─────────────────────────────────────────────
-- The TypeScript recurrence engine (Phase 1) computes next_due; this function
-- performs the two writes atomically in one transaction.
-- Returns json: { completed: Item[], spawned: Item }.
create or replace function complete_and_spawn(
  root_id uuid,
  next_due timestamptz,
  next_index int
)
returns json
language plpgsql
security invoker
as $$
declare
  new_root_id uuid := gen_random_uuid();
  completed_json json;
  spawned_json json;
begin
  -- Capture active descendants (excluding root) before completing.
  -- Each row gets a pre-assigned new UUID for the deep-copy step.
  drop table if exists _ctas_children;
  create temp table _ctas_children on commit drop as
    with recursive tree as (
      select id, parent_id, 0 as depth
      from items
      where id = root_id
      union all
      select c.id, c.parent_id, t.depth + 1
      from items c
      join tree t on c.parent_id = t.id
      where t.depth < 50
    )
    select i.*, gen_random_uuid() as spawned_id
    from items i
    join tree t on i.id = t.id
    where i.id != root_id
      and i.status = 'active';

  -- Complete the subtree and capture the resulting rows.
  select json_agg(row_to_json(r))
  into completed_json
  from complete_subtree(root_id) as r;

  -- Insert the new root occurrence, copying the recurring task's own fields.
  -- (Root is now completed in the DB but non-status fields are still readable.)
  insert into items (
    id, title, notes, source_url, folder_id, item_type, raw_capture,
    recurrence, recurrence_series_id, due_date, occurrence_index,
    status, completed_at, parent_id
  )
  select
    new_root_id, title, notes, source_url, folder_id, item_type, raw_capture,
    recurrence, recurrence_series_id, next_due, next_index,
    'active'::item_status, null::timestamptz, null::uuid
  from items
  where id = root_id;

  -- Deep-copy active children with fresh IDs, remapping parent_id references
  -- within the subtree. Children do not inherit recurrence.
  insert into items (
    id, title, notes, source_url, folder_id, item_type, raw_capture,
    parent_id, recurrence, recurrence_series_id, due_date, occurrence_index,
    status, completed_at
  )
  select
    c.spawned_id,
    c.title, c.notes, c.source_url, c.folder_id, c.item_type, c.raw_capture,
    case
      when c.parent_id = root_id then new_root_id
      else (select p.spawned_id from _ctas_children p where p.id = c.parent_id)
    end,
    null::jsonb,
    null::uuid,
    c.due_date,
    null::int,
    'active'::item_status,
    null::timestamptz
  from _ctas_children c;

  -- Fetch and return the spawned root.
  select row_to_json(i)
  into spawned_json
  from items i
  where id = new_root_id;

  return json_build_object(
    'completed', coalesce(completed_json, '[]'::json),
    'spawned', spawned_json
  );
end;
$$;

-- ── Privileges ────────────────────────────────────────────────────────────────
grant execute on function get_subtree(uuid) to anon, authenticated, service_role;
grant execute on function complete_subtree(uuid) to anon, authenticated, service_role;
grant execute on function complete_and_spawn(uuid, timestamptz, int)
  to anon, authenticated, service_role;
