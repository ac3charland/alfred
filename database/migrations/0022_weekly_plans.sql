-- alfred — weekly plan archive.
--
-- The Friday `weekly-review` skill emits one self-contained HTML document per week. This
-- table is its archive: append-only, one row per upload, no derived metadata — the /plan
-- picker labels rows by `uploaded_at` alone. `html` is the whole document verbatim,
-- rendered in a sandboxed iframe by the /plan view.

create table weekly_plans (
  id          uuid primary key default gen_random_uuid(),
  html        text not null,
  uploaded_at timestamptz not null default now()
);

comment on column weekly_plans.html is
  'The uploaded week-plan document verbatim (inline CSS + inline JS). Never sanitized; rendered
   only inside a sandboxed iframe with an opaque origin (allow-scripts, no allow-same-origin).';

-- The only query shape: newest first (latest plan + picker index).
create index weekly_plans_uploaded_at_idx on weekly_plans (uploaded_at desc);

-- ── RLS + privileges ─────────────────────────────────────────────────────────
-- Single-user: the authenticated owner gets full access; anon is denied (no policy).
alter table weekly_plans enable row level security;

create policy "authenticated full access" on weekly_plans
  for all to authenticated using (true) with check (true);

-- RLS gates which rows; GRANTs gate whether the role may touch the table at all. Raw `psql -f`
-- doesn't get Supabase's auto-grants, so grant DML explicitly (see the supabase skill).
grant select, insert, update, delete on weekly_plans
  to anon, authenticated, service_role;
