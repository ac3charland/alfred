-- Alfred — construct epics in the inbox: 1-deep code subtasks + the epic conversion (ALF-129).
--
-- A code-classified inbox item can now be built out as a parent plus an ordered list of code
-- children (the epic under construction), then converted in one atomic RPC: the parent becomes
-- an epic (its title + notes), each active child becomes a story at the top of the project's
-- Backlog in display order. The same RPC serves "Convert to Code Epic" on a decomposed task.
--
-- Three pieces, in this order (the trigger must be created AFTER the constraint swap):
--   1. Relax items_task_only_fields so a `code` row may carry a parent_id (due dates and
--      completion stay task-only).
--   2. A trigger enforcing the subtask shape: code children are exactly one level deep, hang
--      only off a code ROOT, and the task/code families never mix. Adjacency properties can't
--      be a CHECK, hence the trigger.
--   3. convert_to_code_epic(item, project) — the conversion RPC.

-- ── 1. Let a code item nest, one level deep ─────────────────────────────────────────────────
alter table items drop constraint items_task_only_fields;
alter table items add constraint items_task_only_fields check (
  item_type = 'task'
  or (due_date is null and status = 'active' and completed_at is null
      and (parent_id is null or item_type = 'code'))
);

-- ── 2. Subtask shape: 1-deep code children, no family mixing ────────────────────────────────
-- Note enter_code_module nulls parent_id in the same UPDATE that flips item_type, so gating an
-- item into the factory takes the early-return path here.
create or replace function enforce_subtask_shape() returns trigger
language plpgsql security invoker as $$
declare v_parent items;
begin
  if new.parent_id is null then return new; end if;
  select * into v_parent from items where id = new.parent_id;
  if v_parent is null then
    raise exception 'parent % not found', new.parent_id;
  end if;
  if new.item_type = 'code' then
    if v_parent.item_type <> 'code' then
      raise exception 'a code item may only be nested under another code item';
    end if;
    if v_parent.parent_id is not null then
      raise exception 'code subtasks are one level deep';
    end if;
    if exists (select 1 from items where parent_id = new.id) then
      raise exception 'a code item with children may not itself be nested';
    end if;
  elsif v_parent.item_type = 'code' then
    raise exception 'only a code item may be nested under a code item';
  end if;
  return new;
end; $$;

create trigger items_subtask_shape
  before insert or update of parent_id, item_type on items
  for each row execute function enforce_subtask_shape();

-- ── 3. The conversion RPC ───────────────────────────────────────────────────────────────────
-- Returns json (the complete_and_spawn precedent) because the client needs both the new epic
-- row and the created story sidecars.
create or replace function convert_to_code_epic(p_item uuid, p_project uuid)
returns json language plpgsql security invoker as $$
declare
  v_parent items; v_epic epics; v_child items; v_row code_items;
  v_key text; v_n int; v_priority double precision;
  v_stories code_items[] := '{}';
begin
  select * into v_parent from items where id = p_item;
  if v_parent is null then raise exception 'item % not found', p_item; end if;
  select key into v_key from projects where id = p_project;

  -- The parent IS the epic: same title, same notes, ref from the shared project counter.
  select * into v_epic from create_epic(p_project, v_parent.title);
  if v_parent.notes is not null then
    update epics set notes = v_parent.notes where id = v_epic.id returning * into v_epic;
  end if;

  -- Active children, BOTTOM-UP: each top_of_project_priority() call lands the next child
  -- ABOVE the previous one, so display order comes out as priority order (first child highest).
  for v_child in
    select * from items
     where parent_id = p_item and status = 'active'
     order by sort_order desc, created_at desc
  loop
    v_n        := next_code_ref(p_project);
    v_priority := top_of_project_priority(p_project);
    update items set item_type = 'code', due_date = null, parent_id = null,
                     status = 'active', completed_at = null
      where id = v_child.id;
    insert into code_items (item_id, project_id, epic_id, ref_number, ref, priority)
    values (v_child.id, p_project, v_epic.id, v_n, v_key || '-' || v_n, v_priority)
    returning * into v_row;
    v_stories := v_row || v_stories;   -- prepend, so the array comes back in display order
  end loop;

  -- Consume the parent: a task keeps its history (completed, completed children still
  -- beneath it); a code inbox row has no completion, so it is deleted.
  if v_parent.item_type = 'task' then
    update items set status = 'completed', completed_at = now() where id = p_item;
  else
    delete from items where id = p_item;
  end if;

  return json_build_object('epic', to_json(v_epic), 'stories', to_json(v_stories));
end; $$;

grant execute on function convert_to_code_epic(uuid, uuid)
  to anon, authenticated, service_role;
