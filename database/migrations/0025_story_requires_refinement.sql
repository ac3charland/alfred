-- Alfred — Mark a story as not needing refinement (ALF-137).
--
-- A story enters the factory at `needs_refinement`, and the only way out short of actually
-- refining it was the "Skip to Development" chip — a LAUNCH action that writes
-- `factory_state = 'in_development'` and opens a Claude Code tab in the same click. That welds
-- the judgement ("this one doesn't need a spec") to the act ("start building it right now"), and
-- leaves no trace: nothing distinguished a deliberately-skipped story from a not-yet-refined one.
--
-- `requires_refinement` is that judgement, persisted independently of `factory_state` so it
-- survives a state revert (the Worker sends a closed-unmerged implementation PR back to
-- `ready_for_dev`) and so a future automated dispatcher has a column to query.

alter table code_items
  add column requires_refinement boolean not null default true;

comment on column code_items.requires_refinement is
  'False = a human judged this story small/clear enough to build with no spec. Independent of '
  'factory_state so the intent survives a PR-close revert, and queryable by a future automated '
  'dispatcher. Cleared by the New Story checkbox, the detail-modal toggle, and the '
  'Skip to Development launch.';

-- The board read gains the flag. `create or replace` (not drop/create) APPENDS the column and
-- PRESERVES the view's grants — the 0017 lesson. New columns must go LAST in the select list for
-- the replace to be legal.
create or replace view v_code_stories with (security_invoker = true) as
  select
    c.item_id, c.project_id, c.epic_id, c.ref_number, c.ref, c.factory_state, c.lane,
    c.spec_path, c.spec_sha, c.spec_markdown, c.refinement_pr_url, c.implementation_pr_url,
    c.blocked_reason, c.created_at as code_created_at, c.updated_at as code_updated_at,
    i.title, i.notes, i.source_url, i.created_at as item_created_at,
    p.key as project_key, p.name as project_name, p.repo_owner, p.repo_name,
    e.name as epic_name, e.ref as epic_ref, e.archived_at as epic_archived_at,
    c.priority,
    e.spec_path as epic_spec_path,
    c.blocked_from,
    c.requires_refinement
  from code_items c
  join items i on i.id = c.item_id
  join projects p on p.id = c.project_id
  join epics e on e.id = c.epic_id;

-- Idempotent re-assert (grants survive `create or replace`, but 0017 is the cautionary tale).
grant select on v_code_stories to anon, authenticated, service_role;

-- The creation RPC (0004) learns the flag, so a story can be minted straight into Ready for Dev.
--
-- DROP the old signature first. Adding a defaulted 5th parameter CREATES A SECOND FUNCTION rather
-- than replacing the first, and PostgREST's existing 4-named-arg call then matches BOTH candidates
-- — Postgres answers `function public.create_code_story(...) is not unique` and story creation
-- 500s. Grants do not carry across signatures, so the new one is re-granted below.
drop function if exists create_code_story(uuid, uuid, text, text);

-- The body is 0014's verbatim — including the ALF-110 project-scoped priority landing, which a
-- rewrite from the original 0004 body would silently revert — plus the new parameter and the two
-- columns it drives.
create or replace function create_code_story(
  p_project uuid, p_epic uuid, p_title text, p_notes text default null,
  p_requires_refinement boolean default true
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
  -- ALF-137: a story marked as needing no refinement is minted straight into ready_for_dev, so
  -- it never passes through a lane it has already been judged not to need.
  insert into code_items (item_id, project_id, epic_id, ref_number, ref, priority,
                          requires_refinement, factory_state)
  values (v_item, p_project, p_epic, n, k || '-' || n, v_priority,
          p_requires_refinement,
          case when p_requires_refinement then 'needs_refinement'
               else 'ready_for_dev' end::code_factory_state)
  returning * into row;
  return row;
end; $$;

grant execute on function create_code_story(uuid, uuid, text, text, boolean)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
