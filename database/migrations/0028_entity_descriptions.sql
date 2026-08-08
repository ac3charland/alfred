-- Alfred — folder and project descriptions (ALF-179).
--
-- A folder or a project was distinguishable from its siblings by NAME alone: `folders` is
-- (id, name, created_at, sort_order) and `projects` carries a name, a 3-char key and a repo.
-- "Someday" versus "Work" is a judgement about how the owner uses their own system, and a bare
-- noun does not carry it — not for a person reading the sidebar, and not for the classifier that
-- will one day pick a folder for an inbox item from the list of live ids.
--
-- The description is that judgement, written once by the owner from the folder view / board
-- header: one or two lines saying what belongs here. Nullable with no default, because null
-- (= undescribed) is correct for every existing row and stays a legal value forever.

alter table folders  add column description text;
alter table projects add column description text;

-- The cap: a description is re-sent on every classification request, so an essay pasted into one
-- folder would be a permanent tax on every future item. 500 chars is several times what a real
-- description needs — a backstop, not a workflow (there is deliberately no counter in the UI).
-- The API schemas carry the same bound so a caller gets a 400 rather than this check as a 500.
alter table folders  add constraint folders_description_length
  check (description is null or char_length(description) <= 500);
alter table projects add constraint projects_description_length
  check (description is null or char_length(description) <= 500);

comment on column folders.description is
  'Optional one-or-two-line statement of what belongs in this folder (ALF-179). NULL = undescribed, '
  'which is every folder before this migration. Written by the owner from the folder view header; '
  'destined for the classifier prompt, which needs more than a bare name to choose between '
  'folders. Capped at 500 chars because it is re-sent on every classification request.';
comment on column projects.description is
  'Optional one-or-two-line statement of what this project is and what work belongs in it (ALF-179). '
  'NULL = undescribed. Same purpose and same cap as folders.description.';

-- No backfill (null is already right for every row), and no view to recreate: nothing selects
-- `folders`, and v_code_stories names its project columns explicitly rather than `p.*`, so
-- neither table's reader freezes a column list the way a `select *` view would.

notify pgrst, 'reload schema';
