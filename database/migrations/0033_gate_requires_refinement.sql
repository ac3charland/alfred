-- Alfred — the gate learns the refinement mark (ALF-215).
--
-- A `Bug:` / `Spike:` story is never refined, so it starts in Ready for Dev rather than Needs
-- Refinement. `create_code_story` has taken `p_requires_refinement` since 0025, but the OTHER
-- entry point — `enter_code_module`, the gate that admits an existing inbox item — always landed
-- its sidecar on the `factory_state` column default. A task captured as "Bug: …" and sent to the
-- Code module therefore arrived in a lane its kind can't occupy.
--
-- The kind is derived from the TITLE in the frontend (`storyKindOf`), deliberately: it costs no
-- column, no view change, and a rename re-classifies instantly. So the RPC does NOT re-derive it
-- here — it takes the same boolean `create_code_story` takes and does as it is told, keeping the
-- rule in one place.

-- DROP the old signature first. Adding a defaulted 4th parameter CREATES A SECOND FUNCTION rather
-- than replacing the first, and PostgREST's existing 3-named-arg call then matches BOTH candidates
-- — Postgres answers `function public.enter_code_module(...) is not unique` and every gate 500s.
-- Grants do not carry across signatures, so the new one is re-granted below. (The 0025 lesson.)
drop function if exists enter_code_module(uuid, uuid, uuid);

-- The body is 0026's verbatim — including 0014's ALF-110 project-scoped priority landing and
-- 0026's `dispatched_at` stamp, both of which a rewrite from 0002 would silently revert — plus
-- the new parameter and the two columns it drives.
create or replace function enter_code_module(
  p_item uuid, p_project uuid, p_epic uuid,
  p_requires_refinement boolean default true
)
returns code_items language plpgsql security invoker as $$
declare n int; k text; v_priority double precision; row code_items;
begin
  select key into k from projects where id = p_project;
  n := next_code_ref(p_project);
  -- ALF-110: land at the top of the item's own project, not the whole Backlog.
  v_priority := top_of_project_priority(p_project);
  update items set item_type = 'code', due_date = null, parent_id = null,
                   status = 'active', completed_at = null, dispatched_at = now()
    where id = p_item;
  -- ALF-215: an item judged to need no refinement is admitted straight into ready_for_dev, so it
  -- never passes through a lane it has already been judged not to need (mirrors 0025's
  -- create_code_story).
  insert into code_items (item_id, project_id, epic_id, ref_number, ref, priority,
                          requires_refinement, factory_state)
  values (p_item, p_project, p_epic, n, k || '-' || n, v_priority,
          p_requires_refinement,
          case when p_requires_refinement then 'needs_refinement'
               else 'ready_for_dev' end::code_factory_state)
  returning * into row;
  return row;
end; $$;

grant execute on function enter_code_module(uuid, uuid, uuid, boolean)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
