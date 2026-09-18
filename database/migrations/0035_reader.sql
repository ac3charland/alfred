-- alfred — the Reader module schema (ALF-233).
--
-- Reader turns newsletter email into a short, always-readable list: a publication mails a post,
-- the Worker pulls the mail out of the Comms mirror, extracts the article and asks a model for a
-- gist. A post is never an item. It arrives, gets summarised (or doesn't), gets read (or
-- doesn't), and is archived — it has no due date, no folder, no subtask tree, and nothing about
-- it belongs in the generic capture model. So the module gets its own tables rather than a row in
-- `items`, the same reasoning Comms already applies to a message.
--
-- Two writers reach these tables. The Worker's tick writes publications (discovery), posts
-- (extraction and summarisation) and health with the service role. The browser writes triage
-- state — opened, archived — as the authenticated owner under RLS. Nothing here writes back to
-- Gmail or to Comms; Reader only ever reads `comm_messages` and stamps one column on it to mark a
-- message claimed.
--
-- A post's identity is per Gmail account and message, and it is NOT a cursor: `(account_key,
-- gmail_message_id)` is the dedupe key a concurrent tick's insert either wins or loses on, never
-- something a poller resumes from. The Comms mirror is the antecedent Reader reads from, so the
-- key rides Comms' own account key rather than minting a second one.

-- ── 1. reader_publications — the roster ──────────────────────────────────────
-- There is no publications route yet: a Substack sender is added automatically by discovery, and
-- every other publication is added by hand with the recipe at the bottom of this migration's
-- schema-summary entry in database/README.md.
create table reader_publications (
  id             uuid primary key default gen_random_uuid(),
  handle         text not null unique,
  name           text not null,
  domain         text,
  enabled        boolean not null default true,
  source         text not null,
  notes          text,
  first_seen_at  timestamptz not null default now(),
  created_at     timestamptz not null default now(),

  constraint reader_publications_source_valid check (source in ('auto', 'owner'))
);

comment on column reader_publications.handle is
  'The sender address the roster is keyed on, lower-cased — matched against
   comm_messages.sender_handle by the worklist view.';

comment on column reader_publications.domain is
  'Set by discovery to <local>.substack.com; null for a hand-added, non-Substack publication.
   Never used to resolve a post''s canonical URL — see reader_posts.canonical_url.';

comment on column reader_publications.source is
  'auto = added by the Substack discovery view; owner = inserted by hand in the SQL editor. Both
   are ordinary roster rows from here on — source is provenance, not a permission.';

comment on column reader_publications.enabled is
  'A disabled publication''s mail stays mirrored in comm_messages but the worklist view never
   surfaces it, so pausing a publication takes no post out of the list that already has one.';

-- ── 2. reader_posts — one row per extracted post ─────────────────────────────
create table reader_posts (
  id                   uuid primary key default gen_random_uuid(),
  publication_id       uuid not null references reader_publications (id),
  comm_message_id      uuid references comm_messages (id) on delete set null,
  account_key          text not null,
  gmail_message_id     text not null,
  rfc822_message_id    text,
  title                text not null,
  author               text,
  canonical_url        text,
  received_at          timestamptz not null,
  text                 text,
  word_count           int not null default 0,
  html_extracted       boolean not null default false,
  headline             text,
  gist                 text,
  overview             jsonb,
  model                text,
  prompt_version       int,
  summary_state        text not null default 'pending',
  summarize_attempts   int not null default 0,
  last_error           text,
  summarizing_since    timestamptz,
  model_called_at      timestamptz,
  summarized_at        timestamptz,
  opened_at            timestamptz,
  archived_at          timestamptz,
  created_at           timestamptz not null default now(),

  -- The dedupe key. A fresh insert IS the claim a concurrent tick either wins or loses — never a
  -- cursor, for the same reason comm_messages is keyed on (account, source_id) rather than one.
  unique (account_key, gmail_message_id),
  constraint reader_posts_summary_state_valid
    check (summary_state in ('pending', 'done', 'refused', 'failed')),
  -- Both counts are written by the tick and read back as arithmetic — the attempt ceiling
  -- compare-and-sets on one, the model's input carries the other — so a negative value is a bug
  -- the database can refuse outright rather than a number some later query quietly believes.
  constraint reader_posts_word_count_not_negative check (word_count >= 0),
  constraint reader_posts_summarize_attempts_not_negative check (summarize_attempts >= 0),
  -- A row that claims to be done without a gist is a row nothing can render — the list draws the
  -- gist unclipped as the row's content, never a placeholder for a summary that isn't there.
  constraint reader_posts_done_has_summary
    check (summary_state <> 'done' or (headline is not null and gist is not null and overview is not null))
);

comment on column reader_posts.comm_message_id is
  'The Comms mirror row this post was extracted from, on delete set null so a purge or the
   60-day comms sweep never takes a post down with it — the post outlives the mail it came from.';

comment on column reader_posts.account_key is
  'comm_accounts.key of the Gmail account the mail arrived on. Paired with gmail_message_id as
   the dedupe key; never comm_message_id, which changes if the comms row is ever purged and
   re-mirrored.';

comment on column reader_posts.gmail_message_id is
  'Gmail''s message id (comm_messages.source_id for a gmail account) — the per-message identity,
   paired with account_key. Never the comms row''s own id.';

comment on column reader_posts.rfc822_message_id is
  'Angle brackets kept, exactly as comms stores it — the mailbox-permalink fallback when no
   canonical URL was found in the post.';

comment on column reader_posts.text is
  'The stripped post body, kept only so a post can be re-summarised. Nullable so a retention
   sweep can drop it once a post is old enough that nobody will; the summary columns are never
   swept. Never selected by the list read — see READER_POST_LIST_COLUMNS in the frontend.';

comment on column reader_posts.summary_state is
  'pending = not yet summarised (or a stale claim waiting to be retried); done = a full summary
   exists; refused = the model declined to summarise it; failed = summarize_attempts was
   exhausted. A text column with a CHECK rather than an enum, so the four values are visible in
   one place with the constraint that enforces them.';

comment on column reader_posts.summarize_attempts is
  'Content-shaped failures only, mirroring comm_messages.classify_attempts — a transport failure
   does not count against the three-attempt ceiling that lands a post on failed.';

comment on column reader_posts.summarizing_since is
  'The lease a tick takes before calling the model: stamped at claim, cleared by every terminal
   patch. A claim older than the tick''s own runtime ceiling is stale and free for the next tick
   to retry — Cloudflare does not serialise scheduled invocations, so this is what stops two ticks
   summarising the same pending post.';

comment on column reader_posts.model_called_at is
  'Stamped on every model attempt, success or failure — the daily-cap read counts rows here
   rather than a column on the health singleton, because a stamp is one the terminal patch writes
   anyway and a counter would need its own write plus its own overlap guard.';

comment on column reader_posts.opened_at is
  'Stamped when the owner clicks Open. A failed write here neither rolls back nor surfaces an
   error — missing the stamp once is not worth interrupting reading for.';

comment on column reader_posts.archived_at is
  'NULL = on the reading list. The list''s own read filters on this, matching comm_messages'' use
   of cleared_at as the queue/shelf split.';

-- ── 3. reader_health — the module-level state ────────────────────────────────
-- One row, mirroring comm_classifier_health: the tick's own health is a different failure surface
-- from any one publication's mail, so it gets its own banner rather than living on a post.
create table reader_health (
  id               int primary key default 1,
  last_run_at      timestamptz,
  last_success_at  timestamptz,
  last_error       text,
  last_error_at    timestamptz,

  constraint reader_health_singleton check (id = 1)
);

comment on column reader_health.last_error is
  'The last systemic failure (a missing binding, a rejected credential, an unparsable daily cap).
   Newer than last_success_at means the tick is stalled: mail keeps mirroring into comm_messages,
   nothing new is being pulled into the reading list.';

-- The tick only ever PATCHes this row — insert it here so there is always exactly one.
insert into reader_health (id) values (1);

-- ── 4. comm_messages — the one Comms column Reader owns ──────────────────────
alter table comm_messages add column reader_claimed_at timestamptz;

comment on column comm_messages.reader_claimed_at is
  'NULL for everything that is not a claimed newsletter. Stamped by the Reader intake with the
   service role — on a fresh post AND on a message that turned out unusable (deleted, binned) so
   it is never retried forever — and read by the two Comms SHELF predicates, which drop a claimed
   newsletter from the FYI shelf. The QUEUE predicate never reads it: a publication that is also
   on the people roster is classified normally, and a queued obligation is never hidden by the
   Reader claiming its mail.';

-- ── 5. Indexes ────────────────────────────────────────────────────────────────
-- The reading list: unarchived posts, newest first.
create index reader_posts_received_idx on reader_posts (received_at desc) where archived_at is null;
-- The retry worklist: pending posts, oldest claim first.
create index reader_posts_pending_idx on reader_posts (created_at) where summary_state = 'pending';
-- The daily-cap read: how many model calls have landed since UTC midnight.
create index reader_posts_ceiling_idx on reader_posts (model_called_at) where model_called_at is not null;
-- comm_messages' retention sweep sets comm_message_id null per deleted row — without this it
-- would scan reader_posts once per row swept.
create index reader_posts_comm_message_idx on reader_posts (comm_message_id);
-- The publication join every list read makes.
create index reader_posts_publication_idx on reader_posts (publication_id);
-- The (account_key, gmail_message_id) unique constraint above already carries its own index,
-- which is what backs the worklist view's anti-join — no separate create index needed for it.
--
-- Deliberately NOT indexed: reader_publications(enabled) — a table of tens of rows the planner
-- will seq-scan regardless, the same call migration 0034 makes for comm_accounts. Nor is anything
-- added on comm_messages: v_reader_worklist scans seven days of mail on one account, and the
-- comms table as a whole is already swept at 60 days, so a targeted index here would serve a scan
-- that is already small and short-lived.

-- ── 6. Views ──────────────────────────────────────────────────────────────────

create view v_reader_worklist with (security_invoker = true) as
  select m.id           as comm_message_id,
         m.source_id    as gmail_message_id,
         a.key          as account_key,
         p.id           as publication_id,
         m.sender_handle, m.sender_name, m.subject, m.rfc822_message_id, m.received_at
    from comm_messages m
    join comm_accounts a on a.id = m.account_id and a.key = 'gmail-personal'
    join reader_publications p on p.handle = m.sender_handle and p.enabled
    left join reader_posts r on r.account_key = a.key and r.gmail_message_id = m.source_id
                                              -- the dedupe key, not comm_message_id: a purged and
                                              -- re-mirrored comms row gets a new id but the same source_id
   where m.direction = 'inbound'
     and m.reader_claimed_at is null          -- a binned message claims without a post
     and r.id is null                         -- the anti-join PostgREST cannot express
     and m.received_at >= now() - interval '7 days';   -- the tick's own horizon
-- the tick orders by received_at asc and limits itself

create view v_reader_discovery with (security_invoker = true) as
  select m.sender_handle as handle,
         max(m.sender_name) as name,
         min(m.received_at) as first_seen_at,
         count(*)::int      as message_count
    from comm_messages m
    join comm_accounts a on a.id = m.account_id and a.key = 'gmail-personal'
   where m.direction = 'inbound'
     and m.has_list_header
     and m.sender_handle like '%@substack.com'
     and split_part(m.sender_handle, '@', 1) not in ('no-reply', 'noreply')
     and m.received_at >= now() - interval '7 days'
     and not exists (select 1 from reader_publications p where p.handle = m.sender_handle)
   group by m.sender_handle;

grant select on v_reader_worklist, v_reader_discovery to anon, authenticated, service_role;

-- The roster match is on the roster regardless of the header: a publication whose mail lacks
-- List-Unsubscribe still counts, and one that is also on the Comms people roster still counts.
-- Discovery's three conditions (list header, substack.com, not the platform's own no-reply
-- senders) are what keep Substack's platform mail off the roster. sender_name is what Comms
-- parsed from the From header; the max is just a deterministic pick across several messages.

-- ── 7. RLS + privileges ───────────────────────────────────────────────────────
-- Single-user, same pattern as every other module: the authenticated owner gets full access;
-- anon is denied (no policy). The service role bypasses RLS by design — that is the Worker's
-- tick's write path.
alter table reader_publications enable row level security;
alter table reader_posts        enable row level security;
alter table reader_health       enable row level security;

create policy "authenticated full access" on reader_publications
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on reader_posts
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on reader_health
  for all to authenticated using (true) with check (true);

-- RLS gates which rows; GRANTs gate whether the role may touch the table at all. Raw `psql -f`
-- doesn't get Supabase's auto-grants, so grant DML explicitly (see the supabase skill). Every
-- primary key is gen_random_uuid() or a constant, so there is no sequence to grant.
grant select, insert, update, delete on reader_publications to anon, authenticated, service_role;
grant select, insert, update, delete on reader_posts        to anon, authenticated, service_role;
grant select, insert, update, delete on reader_health        to anon, authenticated, service_role;

-- No realtime publication line in this story — the list is read on load and after an action,
-- with no second writer a browser tab needs to see arrive live.

-- PostgREST caches the schema; the new tables and functions are invisible until it reloads.
notify pgrst, 'reload schema';
