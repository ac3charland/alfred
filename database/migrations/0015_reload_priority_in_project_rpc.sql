-- Alfred — Expose the project-scoped priority jump through PostgREST (ALF-119).
--
-- ALF-110 shipped `move_code_priority_in_project()` in migration 0014, but 0014 was never applied
-- to production (the `priority` column was still `bigint` and BOTH of 0014's new functions were
-- absent), so the Backlog's double-chevron "top/bottom of project" action 500'd with:
--
--   Could not find the function public.move_code_priority_in_project(p_ref, p_to_top)
--   in the schema cache
--
-- That is PostgREST's "this RPC does not exist" error — it resolves an `rpc()` call by the function
-- NAME plus its argument NAMES, and the function simply wasn't in the database. Applying 0014
-- restores it; this migration then does two things a re-run of 0014 would not guarantee on its own:
--
--   1. Re-asserts the RPC idempotently (`create or replace` + grants), so the exact name and
--      argument names PostgREST resolves the double-chevron move by are present regardless of how
--      far 0014 reached this database. The body is identical to 0014's; its `double precision`
--      locals rely on 0014 having already widened `code_items.priority` (0014 runs first).
--   2. Forces PostgREST to reload its schema cache, so a freshly-created (or previously-missed)
--      RPC becomes callable through the Data API immediately instead of staying invisible until
--      the next reload — the direct remedy for the "in the schema cache" symptom.

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

-- A durable marker that the ALF-119 remediation reached this database — the integration suite
-- asserts it, since the schema-cache reload below leaves no queryable trace of its own.
comment on function move_code_priority_in_project(text, boolean) is
  'Backlog double-chevron jump to the top/bottom of the story''s own project (ALF-110). Re-asserted '
  'and exposed to the PostgREST schema cache by ALF-119 after migration 0014 was missed in production.';

-- Reload PostgREST's schema cache so the RPC is callable via the Data API immediately (the fix for
-- "could not find the function … in the schema cache"). A no-op when nothing is listening (e.g. the
-- integration cluster), so it is safe everywhere.
notify pgrst, 'reload schema';
