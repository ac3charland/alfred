-- Create a brand-new code story from the project view: insert the item AND its
-- code_items sidecar in one transaction, landing at needs_refinement. Mirrors
-- enter_code_module (0002 §7) but inserts a fresh item instead of flipping an
-- existing one — there is no inbox row to admit. notes is optional (NULL).
create or replace function create_code_story(
  p_project uuid, p_epic uuid, p_title text, p_notes text default null
) returns code_items language plpgsql security invoker as $$
declare n int; k text; v_item uuid; row code_items;
begin
  select key into k from projects where id = p_project;
  n := next_code_ref(p_project);
  insert into items (title, notes, item_type)
  values (p_title, p_notes, 'code')
  returning id into v_item;
  insert into code_items (item_id, project_id, epic_id, ref_number, ref)
  values (v_item, p_project, p_epic, n, k || '-' || n) returning * into row;
  return row;
end; $$;

grant execute on function create_code_story(uuid, uuid, text, text)
  to anon, authenticated, service_role;
