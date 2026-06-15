-- alfred — Software Factory (the `code` item type) — schema & contract (code-module §4)
--
-- Adds the Project / Epic / Story model that runs the refine → implement
-- lifecycle. A Project = a GitHub repo; an Epic = a grouping bucket; a Story =
-- an `items` row (item_type='code') plus a 1:1 `code_items` sidecar. Refs are
-- `KEY-N`, drawn from a shared per-project counter (epics AND stories).
--
-- Single-user, so RLS mirrors 0001: `authenticated` gets full access; `anon` is
-- denied (no policy); the Worker writes via the service_role/secret key, which
-- bypasses RLS, for the trusted GitHub-webhook ingress (§13).

-- ── Enums (§4.1) ─────────────────────────────────────────────────────────────
create type code_factory_state as enum (
  'needs_refinement',  -- entered the factory; refinement not started
  'in_refinement',     -- user launched the refinement session
  'ready_for_dev',     -- refinement PR merged; spec exists
  'in_development',    -- user launched the implementation session
  'ready_for_review',  -- implementation PR open
  'done',              -- implementation PR merged
  'blocked',           -- escape hatch (checks failing / manual)
  'abandoned'          -- escape hatch (won't ship / manual)
);

create type code_lane as enum ('human', 'local');  -- only 'human' (Lane 2) used now

-- ── Projects (§4.2) — a project = a GitHub repo ──────────────────────────────
-- `key` prefixes every ref; `ref_seq` is the shared per-project counter for
-- epics AND stories. Keep `key` immutable after creation so refs never go stale.
create table projects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  key         text not null unique check (key ~ '^[A-Z][A-Z0-9]{2}$'), -- exactly 3 chars
  repo_owner  text not null,        -- e.g. 'ac3charland'
  repo_name   text not null,        -- e.g. 'alfred'
  github_url  text,                 -- convenience; owner/name is the source of truth
  ref_seq     int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (repo_owner, repo_name)
);

comment on column projects.key is
  'Immutable 3-char uppercase ref prefix (e.g. ALF). Used in refs, branch names, PR frontmatter.';
comment on column projects.ref_seq is
  'Shared per-project ref counter for BOTH epics and stories — allocated atomically via next_code_ref().';

-- ── Epics (§4.2) — organizing buckets; ref drawn from the project counter ────
create table epics (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects (id) on delete cascade,
  name        text not null,
  notes       text,                 -- optional epic-level notes
  ref_number  int  not null,
  ref         text not null unique, -- denormalized KEY-N for display/lookup
  archived_at timestamptz,          -- set when the epic is archived (done); null = active
  created_at  timestamptz not null default now()
);

comment on column epics.archived_at is
  'Set when the epic is manually archived (done); null = active. Archived epics drop off the active board (§9.2).';

-- ── Code stories (§4.2) — 1:1 sidecar on `items` (item_type='code') ──────────
-- Presence of a row here means "this item is in the factory" (so it is hidden
-- from the Tasks/Inbox views — see the task_items view below).
create table code_items (
  item_id               uuid primary key references items (id) on delete cascade,
  project_id            uuid not null references projects (id) on delete restrict,
  epic_id               uuid not null references epics (id) on delete restrict,
  ref_number            int  not null,
  ref                   text not null unique,
  factory_state         code_factory_state not null default 'needs_refinement',
  lane                  code_lane not null default 'human',
  spec_path             text,        -- declared by the refinement PR (§12); never inferred
  spec_sha              text,        -- blob sha of the snapshotted spec
  spec_markdown         text,        -- Worker-written snapshot rendered in the detail modal (§10)
  refinement_pr_url     text,
  implementation_pr_url text,
  blocked_reason        text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on column code_items.spec_path is
  'Path the refinement PR DECLARED for the spec (§12); never inferred. Pairs with spec_sha for "view in repo".';
comment on column code_items.spec_markdown is
  'Worker-written snapshot of the rendered spec (§13.3); the detail modal reads this, not GitHub.';

create index epics_project_id_idx      on epics (project_id);
create index code_items_project_id_idx on code_items (project_id);
create index code_items_epic_id_idx    on code_items (epic_id);
create index code_items_state_idx      on code_items (factory_state);

-- ── Ref allocation & atomic RPCs (§4.3) ──────────────────────────────────────
-- Refs are server-allocated (never client-minted) so two creations can't collide.
-- SECURITY INVOKER so the caller's RLS still applies (mirrors 0001's RPCs).

-- Allocate the next ref number for a project (atomic increment).
create or replace function next_code_ref(p_project uuid) returns int
language sql security invoker as $$
  update projects set ref_seq = ref_seq + 1 where id = p_project returning ref_seq;
$$;

-- Create an epic with an allocated ref; returns the row.
create or replace function create_epic(p_project uuid, p_name text)
returns epics language plpgsql security invoker as $$
declare n int; k text; row epics;
begin
  select key into k from projects where id = p_project;
  n := next_code_ref(p_project);
  insert into epics (project_id, name, ref_number, ref)
  values (p_project, p_name, n, k || '-' || n) returning * into row;
  return row;
end; $$;

-- Move an item into the factory: flip item_type, allocate ref, create the sidecar.
-- Used by both "Send to Code module" (inbox) and "Convert to Code Story" (a task).
create or replace function enter_code_module(p_item uuid, p_project uuid, p_epic uuid)
returns code_items language plpgsql security invoker as $$
declare n int; k text; row code_items;
begin
  select key into k from projects where id = p_project;
  n := next_code_ref(p_project);
  -- Flip to code and clear task-only fields so the §4.6 CHECK holds across conversion.
  update items set item_type = 'code', due_date = null, parent_id = null,
                   status = 'active', completed_at = null
    where id = p_item;
  insert into code_items (item_id, project_id, epic_id, ref_number, ref)
  values (p_item, p_project, p_epic, n, k || '-' || n) returning * into row;
  return row;
end; $$;

-- ── Row-Level Security (§4.4) ────────────────────────────────────────────────
-- Single-user: the authenticated owner gets full access; anon is denied (no policy).
alter table projects   enable row level security;
alter table epics      enable row level security;
alter table code_items enable row level security;

create policy "authenticated full access" on projects
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on epics
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on code_items
  for all to authenticated using (true) with check (true);

-- ── items: task-gating at the database level (§4.6) ──────────────────────────
-- Completion, due dates, and subtasks are TASK-ONLY, enforced in the schema.
-- 1) Promote existing rows to `task` FIRST — every current row is `unclassified`
--    but behaves as a task, so it must satisfy the constraint below.
update items set item_type = 'task' where item_type = 'unclassified';

-- 2) A non-`task` item cannot hold any task-lifecycle value. This makes
--    `unclassified` (and `code`) rows structurally incapable of a due date, a
--    parent (subtask), or a completed status — capture creates them clean, and
--    only `Classify as Task` (§7.1) lets a row gain those. enter_code_module
--    clears these fields so the constraint also holds across conversion.
alter table items add constraint items_task_only_fields check (
  item_type = 'task'
  or (due_date is null and parent_id is null
      and status = 'active' and completed_at is null)
);

-- ── Read paths (§4.5) — the membership split ─────────────────────────────────
-- The dividing line is "does the item have a code_items row?". security_invoker
-- so the underlying tables' RLS still applies (a plain view would run as owner).

-- Tasks / Inbox views read this instead of `items` directly: items NOT in the
-- factory (including code-classified-but-not-yet-sent items).
create view task_items with (security_invoker = true) as
  select i.* from items i
  where not exists (select 1 from code_items c where c.item_id = i.id);

-- The Code view reads this: code stories joined to their item, project, epic.
create view v_code_stories with (security_invoker = true) as
  select
    c.item_id,
    c.project_id,
    c.epic_id,
    c.ref_number,
    c.ref,
    c.factory_state,
    c.lane,
    c.spec_path,
    c.spec_sha,
    c.spec_markdown,
    c.refinement_pr_url,
    c.implementation_pr_url,
    c.blocked_reason,
    c.created_at  as code_created_at,
    c.updated_at  as code_updated_at,
    i.title,
    i.notes,
    i.source_url,
    i.created_at  as item_created_at,
    p.key         as project_key,
    p.name        as project_name,
    p.repo_owner,
    p.repo_name,
    e.name        as epic_name,
    e.ref         as epic_ref,
    e.archived_at as epic_archived_at
  from code_items c
  join items    i on i.id = c.item_id
  join projects p on p.id = c.project_id
  join epics    e on e.id = c.epic_id;

-- ── Privileges (§4.4) ────────────────────────────────────────────────────────
-- RLS gates which rows; table/view GRANTs gate whether the role may touch them at
-- all. Raw `psql -f` (vs `supabase db push`) doesn't get Supabase's auto-grants,
-- so grant DML explicitly (see the supabase skill). anon stays locked out by RLS.
grant select, insert, update, delete on projects, epics, code_items
  to anon, authenticated, service_role;
grant select on task_items, v_code_stories
  to anon, authenticated, service_role;
grant execute on function next_code_ref(uuid), create_epic(uuid, text),
  enter_code_module(uuid, uuid, uuid)
  to anon, authenticated, service_role;
