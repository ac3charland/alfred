-- alfred — habit tracker (ALF-146 / ALF-147).
--
-- Two tables and one enum. A habit is a name plus a list of criteria (a jsonb array, each
-- entry carrying a stable key); a habit_entry is one day's verdict for one habit, carrying
-- BOTH the raw per-criterion results and the status derived from them at write time.
--
-- The per-criterion shape is validated by zod at the route rather than by a check constraint
-- over jsonb: a constraint would restate that rule in a second language and drift from it.

create type habit_day_status as enum ('met', 'partial', 'missed', 'skipped');

create table habits (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  notes        text,
  criteria     jsonb not null,
  active_days  smallint[] not null default '{1,2,3,4,5,6,7}',
  allowance    smallint not null default 0,
  started_on   date not null default current_date,
  archived_at  timestamptz,
  sort_order   int,
  created_at   timestamptz not null default now(),

  -- 1..n criteria, always an array.
  constraint habits_criteria_non_empty
    check (jsonb_typeof(criteria) = 'array' and jsonb_array_length(criteria) >= 1),
  -- ISO weekdays only (1 = Monday), at least one. `cardinality`, NOT `array_length(…, 1)`:
  -- the latter returns NULL for an empty array, and a NULL check constraint is SATISFIED — so
  -- `array_length(active_days, 1) >= 1` would let `'{}'` straight through.
  constraint habits_active_days_valid
    check (active_days <@ array[1,2,3,4,5,6,7]::smallint[] and cardinality(active_days) >= 1),
  -- A rolling window is 7 days, so forgiving 8 is meaningless rather than merely generous.
  constraint habits_allowance_range check (allowance between 0 and 7)
);

comment on column habits.criteria is
  'jsonb array of criteria, each `{ key, label, kind }` plus `target`/`comparator` for a
   measured kind. `key` is stable: renaming a criterion leaves stored results intact.';

comment on column habits.active_days is
  'ISO weekdays (1 = Monday … 7 = Sunday) the habit is scored on. A date outside this set is
   never applicable: it is not a miss and appears in no denominator.';

create table habit_entries (
  id          uuid primary key default gen_random_uuid(),
  habit_id    uuid not null references habits(id) on delete cascade,
  entry_date  date not null,
  status      habit_day_status not null,
  results     jsonb,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- Load-bearing: this is what makes the write path a plain upsert, so logging is idempotent
  -- and correcting a day is the same call as making it.
  unique (habit_id, entry_date)
);

comment on column habit_entries.status is
  'The verdict, FROZEN at write time. Editing a habit''s criteria later never re-scores history.
   Only `skipped` is ever stated by a caller; the other three are derived from `results`.';

comment on column habit_entries.note is
  'Free text about the day. Required (non-empty) when `status` is `skipped` — it is the reason
   the day was excused, enforced by the route.';

-- `updated_at` has no trigger: this repo stamps it from the writer, as `code_items` does.

-- The only query shape: one habit's window, newest first.
create index habit_entries_habit_date_idx on habit_entries (habit_id, entry_date desc);

-- ── RLS + privileges ─────────────────────────────────────────────────────────
-- Single-user: the authenticated owner gets full access; anon is denied (no policy).
alter table habits        enable row level security;
alter table habit_entries enable row level security;

create policy "authenticated full access" on habits
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on habit_entries
  for all to authenticated using (true) with check (true);

-- RLS gates which rows; GRANTs gate whether the role may touch the table at all. Raw `psql -f`
-- doesn't get Supabase's auto-grants, so grant DML explicitly (see the supabase skill). Both
-- primary keys are `gen_random_uuid()`, so there is no sequence to grant.
grant select, insert, update, delete on habits        to anon, authenticated, service_role;
grant select, insert, update, delete on habit_entries to anon, authenticated, service_role;
