-- Alfred — Default a brand-new code story to the TOP of the global Backlog (ALF-71).
--
-- Until now a new story appended to the BOTTOM: code_items.priority defaulted from
-- code_priority_seq (nextval → largest = lowest rank, 0005). The owner almost always wants
-- a freshly-captured story at the top of the queue, so both creation RPCs now stamp an
-- explicit top priority instead of relying on the sequence default.
--
-- Top = one step below every live priority (lower = higher rank), exactly the to-top math
-- move_code_priority computes (0009). `coalesce(min(priority), 0) - 1` handles the first-ever
-- story (no rows → 0 → -1). The chosen value is strictly outside the current range, so the
-- immediate unique(priority) index never sees a transient duplicate — no sentinel dance (the
-- swap's concern, 0007), just a plain INSERT of a value no live row holds.
--
-- The column keeps its `nextval` default as a harmless fallback for any direct insert that
-- omits priority; these RPCs are the only insert paths and both now set it explicitly.

-- ── create_code_story — new story minted from the project view (0004) ────────
create or replace function create_code_story(
  p_project uuid, p_epic uuid, p_title text, p_notes text default null
) returns code_items language plpgsql security invoker as $$
declare n int; k text; v_item uuid; v_priority bigint; row code_items;
begin
  select key into k from projects where id = p_project;
  n := next_code_ref(p_project);
  -- ALF-71: land at the top of the Backlog, not the bottom.
  select coalesce(min(priority), 0) - 1 into v_priority from code_items;
  insert into items (title, notes, item_type)
  values (p_title, p_notes, 'code')
  returning id into v_item;
  insert into code_items (item_id, project_id, epic_id, ref_number, ref, priority)
  values (v_item, p_project, p_epic, n, k || '-' || n, v_priority) returning * into row;
  return row;
end; $$;

grant execute on function create_code_story(uuid, uuid, text, text)
  to anon, authenticated, service_role;

-- ── enter_code_module — admit an existing inbox item to the factory (0002) ───
create or replace function enter_code_module(p_item uuid, p_project uuid, p_epic uuid)
returns code_items language plpgsql security invoker as $$
declare n int; k text; v_priority bigint; row code_items;
begin
  select key into k from projects where id = p_project;
  n := next_code_ref(p_project);
  -- ALF-71: land at the top of the Backlog, not the bottom.
  select coalesce(min(priority), 0) - 1 into v_priority from code_items;
  -- Flip to code and clear task-only fields so the §4.6 CHECK holds across conversion.
  update items set item_type = 'code', due_date = null, parent_id = null,
                   status = 'active', completed_at = null
    where id = p_item;
  insert into code_items (item_id, project_id, epic_id, ref_number, ref, priority)
  values (p_item, p_project, p_epic, n, k || '-' || n, v_priority) returning * into row;
  return row;
end; $$;

grant execute on function enter_code_module(uuid, uuid, uuid)
  to anon, authenticated, service_role;
