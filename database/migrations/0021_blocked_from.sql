-- Alfred — Remember the lane a story was blocked FROM (ALF-136).
--
-- The board used to hide `blocked` stories behind a *Show blocked* toggle and, when revealed,
-- pile them into a single per-epic "Off track" bucket. They now render in place — in the swimlane
-- they occupied at the moment they were blocked — so a blocked story stays visible next to the
-- work it is holding up instead of disappearing off the happy path.
--
-- Nothing recorded that lane: `factory_state` is simply OVERWRITTEN with 'blocked', and there is
-- no transition history. `blocked_from` is that memory — the happy-path state the story left when
-- it entered `blocked`. It is written by the PATCH /api/code/[ref] route on the transition INTO
-- `blocked` and cleared on the way out (including the new Unblock control, which reads it to know
-- where to send the story back).
--
-- Null is the normal resting value for a story that is NOT blocked. It is also what every story
-- blocked BEFORE this migration carries, since their origin lane is unrecoverable — the board
-- falls back to the first lane for those rather than dropping them.

alter table code_items
  add column blocked_from code_factory_state;

comment on column code_items.blocked_from is
  'The happy-path state a story was in when it entered `blocked`, so the board can keep its card '
  'in that swimlane and Unblock can send it back. Null when the story is not blocked (and on rows '
  'blocked before ALF-136, whose origin lane was never recorded).';

-- The board read gains the origin lane. `create or replace` (not drop/create) APPENDS the column
-- and PRESERVES the view's grants — the 0017 lesson. New columns must go LAST in the select list
-- for the replace to be legal.
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
    c.blocked_from
  from code_items c
  join items i on i.id = c.item_id
  join projects p on p.id = c.project_id
  join epics e on e.id = c.epic_id;

-- Idempotent re-assert (grants survive `create or replace`, but 0017 is the cautionary tale).
grant select on v_code_stories to anon, authenticated, service_role;

notify pgrst, 'reload schema';
