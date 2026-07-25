-- Alfred — Epic specs: an epic can carry its own refinement spec (ALF-130).
--
-- An epic-refinement session writes a high-level context/decisions document for the epic and
-- opens a PR carrying `phase: epic-refinement`; the webhook Worker records the PR url on open and,
-- on merge, the declared path plus a snapshot of the file — exactly as it already does for a code
-- story. The column names deliberately MATCH `code_items` so the Worker's snapshot writer and the
-- frontend's spec renderer are shared, not forked.
--
-- Epics have NO lifecycle state, so there is no `factory_state` analogue here — only the spec
-- columns and the PR url. Unlike a story spec (scaffolding, archived by its implementation PR), an
-- epic spec is LONG-LIVED: every later story session in the epic reads it, so it is never archived.

alter table epics
  add column spec_path         text,
  add column spec_sha          text,
  add column spec_markdown     text,
  add column refinement_pr_url text;

comment on column epics.spec_path is
  'Path the epic-refinement PR DECLARED for the epic spec; never inferred. Long-lived — unlike a '
  'story spec it is never archived, because story prompts keep referencing it.';
comment on column epics.spec_markdown is
  'Worker-written snapshot of the rendered epic spec; the epic spec modal reads this, not GitHub.';

-- The board read gains the epic's spec path so the story launch prompts can point at it.
-- `create or replace` (not drop/create) APPENDS the column and PRESERVES the view's grants —
-- the 0017 lesson. New columns must go LAST in the select list for the replace to be legal.
create or replace view v_code_stories with (security_invoker = true) as
  select
    c.item_id, c.project_id, c.epic_id, c.ref_number, c.ref, c.factory_state, c.lane,
    c.spec_path, c.spec_sha, c.spec_markdown, c.refinement_pr_url, c.implementation_pr_url,
    c.blocked_reason, c.created_at as code_created_at, c.updated_at as code_updated_at,
    i.title, i.notes, i.source_url, i.created_at as item_created_at,
    p.key as project_key, p.name as project_name, p.repo_owner, p.repo_name,
    e.name as epic_name, e.ref as epic_ref, e.archived_at as epic_archived_at,
    c.priority,
    e.spec_path as epic_spec_path
  from code_items c
  join items i on i.id = c.item_id
  join projects p on p.id = c.project_id
  join epics e on e.id = c.epic_id;

-- Idempotent re-assert (grants survive `create or replace`, but 0017 is the cautionary tale).
grant select on v_code_stories to anon, authenticated, service_role;

-- The Worker writes the snapshot out-of-band, so an open board needs a push channel to show it
-- without a reload — the epics analogue of 0003's code_items stream. RLS still governs it: epics
-- already has the `authenticated full access` policy from 0002.
alter publication supabase_realtime add table epics;

notify pgrst, 'reload schema';
