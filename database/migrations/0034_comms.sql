-- alfred — the Comms module schema (ALF-7).
--
-- Comms is a response queue over four accounts — two Gmail, one IMAP mailbox and iMessage —
-- and it is never the store of record: every message stays where it already lives, alfred holds
-- a copy, a verdict and triage state, and losing this schema loses the interface and nothing
-- else. A message is never an item. It has a different lifecycle (it arrives, is answered
-- elsewhere, and is never "done" here), so it gets its own tables rather than a row in `items`.
--
-- Three writers reach these tables and the roles say which is which. The browser writes triage
-- state, corrections, the rubric and the people list as the authenticated owner under RLS. The
-- Worker writes messages, verdicts and account health with the service role. The Mac daemon
-- holds no database credential at all: it POSTs to the Worker's HMAC-signed ingest endpoint and
-- that endpoint does the write. Nothing here writes back to any source.
--
-- The identity of a message is per source and is NOT the ingestion cursor. A cursor says where
-- to resume; a key says whether two rows are the same message — and the obvious cursor is a
-- dangerous key for two of the three sources (an IMAP UIDVALIDITY change reassigns every UID; a
-- chat.db ROWID is unstable across a rebuild or an iCloud re-sync). So `comm_messages` is unique
-- on (account, source_id) where source_id is Gmail's message id, the RFC822 Message-ID (or
-- UIDVALIDITY:UID when a message has none) for IMAP, and chat.db's guid for iMessage.

create type comm_tier as enum ('asap', 'today', 'whenever', 'fyi');
create type comm_account_kind as enum ('gmail', 'imap', 'imessage');

-- ── 1. comm_accounts — one row per mailbox / channel ─────────────────────────
-- Accounts self-register: the Worker upserts its Gmail accounts by key on its first poll and
-- the daemon's heartbeat upserts the two it carries. Nothing is seeded here, because the two
-- alfred instances hold different accounts and a migration may not assume either's data.
create table comm_accounts (
  id                        uuid primary key default gen_random_uuid(),
  key                       text not null unique,
  kind                      comm_account_kind not null,
  label                     text not null,
  home                      text not null,
  owner_handles             text[] not null default '{}',
  enabled                   boolean not null default true,
  expected_interval_seconds int not null default 600,
  cursor                    jsonb,
  last_seen_at              timestamptz,
  last_error                text,
  last_error_at             timestamptz,
  created_at                timestamptz not null default now(),

  constraint comm_accounts_home_valid check (home in ('worker', 'daemon')),
  constraint comm_accounts_interval_positive check (expected_interval_seconds > 0)
);

comment on column comm_accounts.key is
  'Stable slug the pollers address the account by (gmail-personal, gmail-realplay, workmail,
   imessage). Secrets and cursors are keyed on it; the label is what the owner sees.';

comment on column comm_accounts.owner_handles is
  'The owner''s own addresses or handles on this account, lower-cased. A message whose sender
   is one of these is outbound — never classified, and the signal that drains a thread.';

comment on column comm_accounts.cursor is
  'Where the poller resumes: a Gmail historyId, an IMAP {uidvalidity, uid}, a chat.db ROWID.
   NULL = never polled; the first run seeds from a 7-day lookback and never from zero.';

comment on column comm_accounts.last_seen_at is
  'Stamped on every SUCCESSFUL poll, not on every message — quiet and broken are only
   distinguishable by whether the poll itself succeeded. NULL = never polled.';

comment on column comm_accounts.last_error is
  'The last poll error and (`last_error_at`) when. An error newer than `last_seen_at` means the
   account is erroring, not quiet; older means a past hiccup the next poll has already cleared.';

comment on column comm_accounts.expected_interval_seconds is
  'How long without a successful poll counts as stale. Per source: Gmail rides a two-minute
   cron; the daemon''s two coalesce their heartbeat to once a minute and go dark when the Mac
   sleeps.';

-- ── 2. comm_messages — the mirrored message ──────────────────────────────────
create table comm_messages (
  id                      uuid primary key default gen_random_uuid(),
  account_id              uuid not null references comm_accounts (id) on delete cascade,
  source_id               text not null,
  rfc822_message_id       text,
  thread_key              text not null,
  direction               text not null default 'inbound',
  sender_handle           text not null,
  sender_name             text,
  chat_name               text,
  participants            text[] not null default '{}',
  subject                 text,
  body                    text not null default '',
  received_at             timestamptz not null,
  body_extracted          boolean not null default true,
  has_attachments         boolean not null default false,
  in_reply_to             text,
  references_ids          text[] not null default '{}',
  filtered_reason         text,
  classify_attempts       int not null default 0,
  tier                    comm_tier,
  judged_by               text,
  ask                     text,
  verdict_id              uuid,
  classified_at           timestamptz,
  reclassify_requested_at timestamptz,
  cleared_at              timestamptz,
  cleared_by              text,
  inbox_item_id           uuid references items (id) on delete set null,
  created_at              timestamptz not null default now(),

  -- The dedupe key. A re-seed after a lost cursor is a no-op against this; keyed on the
  -- cursor it would be a corruption that looks like normal operation.
  unique (account_id, source_id),
  constraint comm_messages_direction_valid check (direction in ('inbound', 'outbound')),
  constraint comm_messages_filtered_reason_valid
    check (filtered_reason is null or filtered_reason in ('newsletter')),
  constraint comm_messages_judged_by_valid
    check (judged_by is null or judged_by in ('model', 'filter', 'owner', 'unjudged', 'refusal')),
  -- A tier and how it was reached arrive together: a tier nobody chose is not a tier.
  constraint comm_messages_tier_judged_together
    check ((tier is null) = (judged_by is null)),
  constraint comm_messages_cleared_by_valid
    check (cleared_by is null or cleared_by in ('reply', 'nothing_to_answer', 'not_replying', 'inbox_item')),
  constraint comm_messages_cleared_together
    check ((cleared_at is null) = (cleared_by is null))
);

comment on column comm_messages.source_id is
  'The per-source identity: Gmail''s message id, the RFC822 Message-ID (else UIDVALIDITY:UID)
   for IMAP, chat.db''s guid for iMessage. Never a cursor.';

comment on column comm_messages.rfc822_message_id is
  'Captured for every email regardless of source, because deep links are built from it and it
   is cheap now and annoying to backfill. NULL for iMessage.';

comment on column comm_messages.thread_key is
  'Gmail''s threadId; for IMAP the root of the References chain (else its own Message-ID); for
   iMessage the chat guid. Reply detection reads it: an outbound message in the same thread
   drains every queued row that arrived before it.';

comment on column comm_messages.direction is
  'inbound = arrived for the owner; outbound = the owner sent it. Outbound rows are mirrored
   as the drain signal and are never classified or queued.';

comment on column comm_messages.body_extracted is
  'false = the body failed to decode (an attributedBody blob, an odd MIME part). The row is
   still written — a skipped message is a false negative that leaves no trace — and it takes
   the can''t-judge path into Today, marked, without a model call.';

comment on column comm_messages.filtered_reason is
  'Set when the deterministic header filter, not the model, shelved the message (a genuine
   List-Unsubscribe / List-ID header). Such a row has no verdict and must be distinguishable
   on the shelf from mail the model actually judged.';

comment on column comm_messages.classify_attempts is
  'Content-shaped failures only (unparseable, a tier outside the enum, max_tokens). Transport
   failures are not counted — with an active ceiling, counting them would empty an outage into
   a counted tier. At five the message lands on Today as unjudged.';

comment on column comm_messages.tier is
  'The effective tier: the verdict''s, unless the owner changed it. NULL = not yet judged.
   `judged_by` says who set it: the model, the header filter, the owner, the attempt ceiling
   or a decode failure (unjudged), or a model refusal (shelved, flagged).';

comment on column comm_messages.reclassify_requested_at is
  'An explicit re-run request from the owner. Nothing is ever re-judged silently: editing the
   rubric, the example set or the roster sweeps nothing. NULL = no request pending.';

comment on column comm_messages.cleared_at is
  'Triage state lives on the message, not the verdict, so it survives a re-classification.
   The three exits: reply (detected), nothing_to_answer / not_replying (the owner), or
   inbox_item (the obligation moved into the Inbox and the row cleared at that moment).';

-- The sweep''s one query: inbound, unjudged (or re-run requested), oldest first.
create index comm_messages_unjudged_idx on comm_messages (received_at)
  where tier is null and direction = 'inbound';
-- The retention sweep, the queue and the shelf all read by arrival.
create index comm_messages_received_idx on comm_messages (received_at desc);
-- Reply detection: the queued rows of one thread.
create index comm_messages_thread_idx on comm_messages (account_id, thread_key);
-- Reply detection over IMAP: a sent message names the queued Message-ID in References.
create index comm_messages_rfc822_idx on comm_messages (rfc822_message_id)
  where rfc822_message_id is not null;

-- ── 3. comm_people + comm_handles — the people list ──────────────────────────
-- A person with a priority and many handles: the same human is a phone number in iMessage
-- and an email address in two mailboxes, so the roster is keyed on the person, never the
-- address. Rendered into the prompt; edited in the UI, not in prose.
create table comm_people (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  priority    text not null default 'high',
  notes       text,
  created_at  timestamptz not null default now(),

  constraint comm_people_priority_valid check (priority in ('high', 'normal', 'low'))
);

comment on column comm_people.priority is
  'high = a priority person: delay costs something real, and a text-less message from them
   is queued on that basis alone. low = never urgent, however the message reads. normal is
   for a person listed only so a handle resolves to a name.';

create table comm_handles (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references comm_people (id) on delete cascade,
  handle      text not null unique,
  kind        text not null,
  created_at  timestamptz not null default now(),

  constraint comm_handles_kind_valid check (kind in ('email', 'phone'))
);

comment on column comm_handles.handle is
  'Normalised: a lower-cased email address, or a phone number as digits with its leading +.
   Unique across people — one handle resolves to one human.';

-- ── 4. comm_rubrics — the versioned rubric ───────────────────────────────────
-- Append-only. Every verdict names the version that produced it, so "why did it say that"
-- stays answerable after an edit. The writer assigns `version` as max + 1 (single user; the
-- unique constraint is the referee), so there is no sequence to grant.
create table comm_rubrics (
  id          uuid primary key default gen_random_uuid(),
  version     int not null unique,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- ── 5. comm_verdicts — the model's judgment ──────────────────────────────────
-- Separate from the message so a re-classification is a new row, not a destroyed one. Full
-- provenance: a verdict stamped with only one of rubric and example-set version is not
-- reconstructable, which defeats the point of versioning either.
create table comm_verdicts (
  id                   uuid primary key default gen_random_uuid(),
  message_id           uuid not null references comm_messages (id) on delete cascade,
  tier                 comm_tier not null,
  owes_reply           boolean not null,
  ask                  text not null,
  reason               text not null,
  provider             text not null,
  model                text not null,
  prompt_version       int not null,
  rubric_version       int not null,
  example_set_version  int not null,
  person_id            uuid references comm_people (id) on delete set null,
  created_at           timestamptz not null default now()
);

comment on column comm_verdicts.person_id is
  'The roster person the sender resolved to when this verdict was made, if any — the
   "flagged because it is from Dana" audit trail.';

create index comm_verdicts_message_idx on comm_verdicts (message_id, created_at desc);

alter table comm_messages
  add constraint comm_messages_verdict_fk
  foreign key (verdict_id) references comm_verdicts (id) on delete set null;

comment on column comm_messages.verdict_id is
  'The verdict the current tier came from (NULL when the tier was set without one: the
   filter, the ceiling, a decode failure). A re-run writes a new verdict and moves this.';

-- ── 6. comm_corrections — every correction, doubling as the example set ──────
-- A tier change, or "Nothing to answer" on a queued row (a demotion to fyi). The message
-- text is denormalised and outlives its message: the 60-day sweep does not touch it, a manual
-- purge nulls it. Versioned as a set: every insert AND every prune bumps the set version, and
-- membership at version V is `created_version <= V and (pruned_version is null or
-- pruned_version > V)` — so a verdict stamped "set v7" is answerable months later without a
-- membership table.
create table comm_corrections (
  id               uuid primary key default gen_random_uuid(),
  message_id       uuid references comm_messages (id) on delete set null,
  account_label    text not null,
  sender_handle    text not null,
  sender_name      text,
  subject          text,
  body_excerpt     text,
  model_tier       comm_tier,
  chosen_tier      comm_tier not null,
  kind             text not null,
  created_version  int not null,
  pruned_version   int,
  pruned_at        timestamptz,
  purged_at        timestamptz,
  created_at       timestamptz not null default now(),

  constraint comm_corrections_kind_valid check (kind in ('tier_change', 'nothing_to_answer')),
  constraint comm_corrections_pruned_together
    check ((pruned_at is null) = (pruned_version is null))
);

comment on column comm_corrections.body_excerpt is
  'The message text truncated to the per-example budget at write time — an email body is not
   a one-line capture, and the bill is only honest for a prompt that stops growing. NULL after
   a manual purge (`purged_at`); such a row is never drawn as an example.';

comment on column comm_corrections.model_tier is
  'The tier the model chose. NULL when the row had no verdict (the ceiling, a decode failure)
   — a correction of an unjudged row still teaches, but has no guess to contrast.';

create index comm_corrections_created_idx on comm_corrections (created_at desc);

-- The current example-set version: the highest version any insert or prune has claimed.
create or replace function comm_example_set_version()
returns int
language sql
security invoker
stable
as $$
  select coalesce(max(greatest(created_version, coalesce(pruned_version, 0))), 0)
  from comm_corrections;
$$;

grant execute on function comm_example_set_version() to anon, authenticated, service_role;

-- Stamp the version on insert, and again when a row is pruned. A trigger rather than the
-- route: the browser inserts a correction and the database numbers the set, so no writer can
-- forget to bump it and no two writers can disagree about the count.
create or replace function comm_corrections_stamp_version()
returns trigger
language plpgsql
security invoker
as $$
begin
  if tg_op = 'INSERT' then
    new.created_version := comm_example_set_version() + 1;
  elsif new.pruned_at is not null and old.pruned_at is null then
    new.pruned_version := comm_example_set_version() + 1;
  end if;
  return new;
end; $$;

create trigger comm_corrections_stamp_version
  before insert or update on comm_corrections
  for each row execute function comm_corrections_stamp_version();

-- ── 7. comm_classifier_health — the module-level state ──────────────────────
-- A classifier outage is not a source state: ingestion is healthy and judgment has stalled,
-- and the fix is different, so it gets its own banner above the per-account dots. One row.
create table comm_classifier_health (
  id               int primary key default 1,
  last_run_at      timestamptz,
  last_success_at  timestamptz,
  last_error       text,
  last_error_at    timestamptz,

  constraint comm_classifier_health_singleton check (id = 1)
);

comment on column comm_classifier_health.last_error is
  'The last systemic failure (a missing binding, a rejected credential, a rejected request
   shape). Newer than `last_success_at` means the classifier is stalled: everything still
   arriving is still stored; nothing new is being judged.';

-- ── 8. Reply detection — the drain ───────────────────────────────────────────
-- An outbound message drains every queued inbound row of the same account that arrived before
-- it and shares its thread, or that the sent message names in its References chain (IMAP has
-- no thread id, so the Sent folder is read that way). Only queued rows: fyi stays where it is,
-- and a row the owner already cleared keeps the exit it left by.
create or replace function comm_record_reply(
  p_account uuid,
  p_thread_key text,
  p_references text[],
  p_at timestamptz
)
returns int
language plpgsql
security invoker
as $$
declare
  v_count int;
begin
  update comm_messages
  set cleared_at = p_at, cleared_by = 'reply'
  where account_id = p_account
    and direction = 'inbound'
    and cleared_at is null
    and tier in ('asap', 'today', 'whenever')
    and received_at < p_at
    and (
      thread_key = p_thread_key
      or (rfc822_message_id is not null and rfc822_message_id = any (p_references))
    );
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

grant execute on function comm_record_reply(uuid, text, text[], timestamptz)
  to anon, authenticated, service_role;

-- ── 9. Retention and purge ───────────────────────────────────────────────────
-- Every message row is deleted at 60 days, whole, across every tier — the driver is security,
-- not volume: a bounded blast radius if this database is ever exposed. Verdicts cascade;
-- corrections keep their denormalised text (message_id goes null), because the example set is
-- what makes the rubric improve rather than reset every two months. The Worker calls this on
-- its own daily cron; there is no pg_cron here and nothing runs inside the migration.
create or replace function comm_sweep_expired(p_days int default 60)
returns int
language plpgsql
security invoker
as $$
declare
  v_count int;
begin
  delete from comm_messages
  where received_at < now() - make_interval(days => p_days);
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

grant execute on function comm_sweep_expired(int) to anon, authenticated, service_role;

-- A manual purge — one message, one account, or everything older than a date — is the
-- deliberate "I want this gone", and unlike the sweep it DOES cascade into the example set:
-- the corrections for the purged rows lose their text. Rows that lost their message to an
-- earlier sweep are matched by the same filters through their own columns, so purging an
-- account or a date range also reaches examples whose message is already gone.
create or replace function comm_purge(
  p_message uuid default null,
  p_account uuid default null,
  p_before timestamptz default null
)
returns int
language plpgsql
security invoker
as $$
declare
  v_count int;
begin
  if p_message is null and p_account is null and p_before is null then
    raise exception 'comm_purge needs a message, an account, or a cutoff';
  end if;

  update comm_corrections c
  set body_excerpt = null, subject = null, purged_at = now()
  where c.purged_at is null
    and (
      (p_message is not null and c.message_id = p_message)
      or exists (
        select 1 from comm_messages m
        where m.id = c.message_id
          and (p_account is null or m.account_id = p_account)
          and (p_before is null or m.received_at < p_before)
          and p_message is null
      )
      or (
        p_message is null and c.message_id is null
        and (p_account is null or c.account_label = (select label from comm_accounts where id = p_account))
        and (p_before is null or c.created_at < p_before)
      )
    );

  delete from comm_messages m
  where (p_message is null or m.id = p_message)
    and (p_account is null or m.account_id = p_account)
    and (p_before is null or m.received_at < p_before);
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

grant execute on function comm_purge(uuid, uuid, timestamptz)
  to anon, authenticated, service_role;

-- ── 10. RLS + privileges ─────────────────────────────────────────────────────
-- Single-user: the authenticated owner gets full access; anon is denied (no policy). The
-- service role bypasses RLS by design — that is the Worker's write path.
alter table comm_accounts          enable row level security;
alter table comm_messages          enable row level security;
alter table comm_people            enable row level security;
alter table comm_handles           enable row level security;
alter table comm_rubrics           enable row level security;
alter table comm_verdicts          enable row level security;
alter table comm_corrections       enable row level security;
alter table comm_classifier_health enable row level security;

create policy "authenticated full access" on comm_accounts
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on comm_messages
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on comm_people
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on comm_handles
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on comm_rubrics
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on comm_verdicts
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on comm_corrections
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on comm_classifier_health
  for all to authenticated using (true) with check (true);

-- RLS gates which rows; GRANTs gate whether the role may touch the table at all. Raw `psql -f`
-- doesn't get Supabase's auto-grants, so grant DML explicitly (see the supabase skill). Every
-- primary key is `gen_random_uuid()` or a constant, so there is no sequence to grant.
grant select, insert, update, delete on comm_accounts          to anon, authenticated, service_role;
grant select, insert, update, delete on comm_messages          to anon, authenticated, service_role;
grant select, insert, update, delete on comm_people            to anon, authenticated, service_role;
grant select, insert, update, delete on comm_handles           to anon, authenticated, service_role;
grant select, insert, update, delete on comm_rubrics           to anon, authenticated, service_role;
grant select, insert, update, delete on comm_verdicts          to anon, authenticated, service_role;
grant select, insert, update, delete on comm_corrections       to anon, authenticated, service_role;
grant select, insert, update, delete on comm_classifier_health to anon, authenticated, service_role;

-- ── 11. Realtime ─────────────────────────────────────────────────────────────
-- The Worker and the daemon write out of band; the browser has to see a row arrive, a verdict
-- land and a dot change colour without a reload. RLS still governs the stream.
alter publication supabase_realtime add table comm_messages;
alter publication supabase_realtime add table comm_accounts;
alter publication supabase_realtime add table comm_classifier_health;

-- PostgREST caches the schema; the new tables and functions are invisible until it reloads.
notify pgrst, 'reload schema';
