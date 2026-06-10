-- alfred — initial schema (Phase 1)
--
-- Generic-item core (SPEC §3.2) + task-specific fields (§3.3) + folders (§3.4).
-- Single-user app: RLS grants the `authenticated` role full access; `anon` is
-- implicitly denied (§7). The server-side service_role/secret key bypasses RLS
-- for the Siri/external ingress.

-- ── Enums ────────────────────────────────────────────────────────────────────
create type item_type as enum ('unclassified', 'task', 'code', 'knowledge');
create type item_status as enum ('active', 'completed');

-- ── Folders (§3.4) — flat organizational buckets, no special logic ──────────
create table folders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

-- ── Items: generic base (§3.2) + task-specific fields (§3.3) ─────────────────
create table items (
  -- generic base (every item, any type)
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  notes        text,
  source_url   text,
  item_type    item_type not null default 'unclassified',
  created_at   timestamptz not null default now(),
  raw_capture  text,
  -- task lifecycle (null/ignored for non-task types)
  due_date     timestamptz,
  status       item_status not null default 'active',
  completed_at timestamptz,
  folder_id    uuid references folders (id) on delete set null,
  parent_id    uuid references items (id) on delete cascade
);

comment on column items.parent_id is
  'Self-reference adjacency list for arbitrary-depth subtasks (§3.3). ON DELETE CASCADE removes the whole subtree.';
comment on column items.folder_id is
  'null = Inbox; a value = filed into that folder (§3.3/§3.4). ON DELETE SET NULL returns items to the Inbox if a folder is removed.';

-- ── Indexes (hot query paths) ────────────────────────────────────────────────
create index items_parent_id_idx on items (parent_id);
create index items_folder_id_idx on items (folder_id);
create index items_status_idx on items (status);
create index items_item_type_idx on items (item_type);

-- ── Row-Level Security (§7) ──────────────────────────────────────────────────
-- Single-user: the authenticated owner gets full access; anon is denied (no policy).
alter table items enable row level security;
alter table folders enable row level security;

create policy "authenticated full access" on items
  for all to authenticated using (true) with check (true);

create policy "authenticated full access" on folders
  for all to authenticated using (true) with check (true);

-- ── Recursive subtree read (§3.3) ────────────────────────────────────────────
-- PostgREST can't express WITH RECURSIVE; expose it via rpc(). Depth-guarded
-- against cycles. SECURITY INVOKER so the caller's RLS still applies.
create or replace function get_subtree(root_id uuid)
returns table (
  id uuid,
  title text,
  notes text,
  source_url text,
  item_type item_type,
  created_at timestamptz,
  raw_capture text,
  due_date timestamptz,
  status item_status,
  completed_at timestamptz,
  folder_id uuid,
  parent_id uuid,
  depth int
)
language sql
stable
security invoker
as $$
  with recursive subtree as (
    select i.*, 0 as depth
    from items i
    where i.id = root_id

    union all

    select c.*, s.depth + 1
    from items c
    inner join subtree s on c.parent_id = s.id
    where s.depth < 50
  )
  select id, title, notes, source_url, item_type, created_at, raw_capture,
         due_date, status, completed_at, folder_id, parent_id, depth
  from subtree
  order by depth, created_at;
$$;

-- ── Cascade completion (§3.6) ────────────────────────────────────────────────
-- Mark a task and ALL its descendants completed in one statement; returns the rows.
create or replace function complete_subtree(root_id uuid)
returns setof items
language sql
security invoker
as $$
  with recursive subtree as (
    select id, 0 as depth from items where id = root_id
    union all
    select c.id, s.depth + 1 from items c
    inner join subtree s on c.parent_id = s.id
    where s.depth < 50  -- guard against parent_id cycles (matches get_subtree)
  )
  update items
  set status = 'completed', completed_at = now()
  where id in (select id from subtree)
  returning *;
$$;

-- ── Privileges (§7) ──────────────────────────────────────────────────────────
-- RLS (above) gates *which rows* a role sees; table GRANTs gate whether the role
-- may touch the table at all. Supabase's auto-grant default privileges don't
-- reliably cover objects created by `postgres` over the connection pooler (raw
-- `psql -f` instead of `supabase db push`), so grant DML explicitly. anon stays
-- locked out by RLS (no policy), authenticated gets the full-access policy, and
-- service_role bypasses RLS for the trusted Siri/external ingress.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on items, folders
  to anon, authenticated, service_role;
grant execute on function get_subtree(uuid), complete_subtree(uuid)
  to anon, authenticated, service_role;
