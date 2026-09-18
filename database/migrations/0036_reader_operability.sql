-- alfred — making the Reader operable (ALF-234).
--
-- 0035 built the pipe: mail becomes a post, a post gets a summary, the list renders it. It is
-- administered by SQL and diagnosed by `wrangler tail`. This migration is the schema half of
-- making it legible and bounded from the app itself:
--
--   * the tick stamps the ceiling it enforced on the health row, so the UI can say "30 of 30
--     today" without knowing the Worker's deploy vars;
--   * a bulk sender that is NOT on the roster is offered as a candidate rather than found by
--     hand in the mirror;
--   * "last post" is derived rather than denormalised — 0035 deliberately dropped the
--     `last_post_at` column the epic sketched, because a per-post write to the roster costs the
--     tick a subrequest it does not have;
--   * and a post's stored body is swept once it is past the retention window, which is the first
--     thing here with a cost that grows: summaries are kept forever, bodies for ninety days.

-- ── 1. reader_health — the ceiling the tick enforced ──────────────────────────
-- 0035's health row says whether the tick RAN and whether it got through. It says nothing about
-- the money guard, and the guard is derived (a count over `reader_posts.model_called_at`) rather
-- than kept on a counter — so a reader of the health row alone could not tell an idle day from a
-- day that spent its budget by noon. The tick already knows both numbers at the end of its run;
-- these three columns are it writing them down, at no extra subrequest.
alter table reader_health
  add column daily_cap  int,
  add column calls_today int,
  add column calls_day   date;

comment on column reader_health.daily_cap is
  'The cap the tick enforced on its last run, copied off READER_DAILY_CAP. Written so a reader —
   the UI''s ceiling banner above all — never has to hard-code the Worker''s deploy var to say
   what "full" means.';

comment on column reader_health.calls_today is
  'Model calls the tick had made for calls_day when it last wrote this row: the count it read at
   the start of the run plus the calls it made during it. Null before the first tick that counted.';

comment on column reader_health.calls_day is
  'The UTC date calls_today belongs to — the same UTC window the tick counts model calls over.
   "The ceiling is reached" is calls_today >= daily_cap AND (calls_day is today OR the tick has
   not run yet today): between midnight UTC and the day''s first tick nothing has been reset, so a
   capped yesterday still reads as capped rather than as a stalled summariser.';

-- ── 2. reader_posts — when the body was swept ─────────────────────────────────
alter table reader_posts add column text_swept_at timestamptz;

comment on column reader_posts.text_swept_at is
  'Stamped by the retention sweep in the same UPDATE that nulls `text`. Null = the post still
   holds its body. A swept post can never be re-summarised — there is nothing left to send the
   model — and that is a different sentence for the owner than "this post never had a body",
   which is why the stamp exists rather than being inferred from a null `text`.';

-- ── 3. v_reader_candidates — bulk senders not on the roster ───────────────────
-- The roster's own discovery view (`v_reader_discovery`) is narrow on purpose: Substack senders
-- only, inside the tick's seven-day horizon, because it AUTO-ADDS what it finds. This one is the
-- opposite end of the same signal — every bulk sender the comms header filter saw on the personal
-- account inside thirty days, whatever the domain — because a human decides what to do with it.
-- Ranked by volume, then recency; the most recent display name the sender used wins.
create view v_reader_candidates with (security_invoker = true) as
  select
    m.sender_handle as handle,
    (array_agg(m.sender_name order by m.received_at desc)
       filter (where m.sender_name is not null))[1] as name,
    count(*)::int      as message_count,
    max(m.received_at) as last_seen_at
    from comm_messages m
    join comm_accounts a on a.id = m.account_id and a.key = 'gmail-personal'
   where m.direction = 'inbound'
     and m.has_list_header
     and m.received_at >= now() - interval '30 days'
     and not exists (select 1 from reader_publications p where p.handle = m.sender_handle)
   group by m.sender_handle
   order by count(*) desc, max(m.received_at) desc;

-- ── 4. v_reader_publications — the roster with its last post ──────────────────
-- `last_post_at` is derived, not stored: stamping the roster on every post would cost the tick a
-- write per post out of a subrequest budget that is already the thing bounding how many posts a
-- tick can take on. A publication with no post yet reads null, which is exactly what the roster
-- card renders as "nothing yet".
create view v_reader_publications with (security_invoker = true) as
  select p.id, p.handle, p.name, p.domain, p.enabled, p.source, p.notes,
         p.first_seen_at, p.created_at,
         max(r.received_at) as last_post_at
    from reader_publications p
    left join reader_posts r on r.publication_id = p.id
   group by p.id
   order by p.name;

grant select on v_reader_candidates, v_reader_publications to anon, authenticated, service_role;

-- ── 5. reader_sweep_text — one batch of the ninety-day sweep ──────────────────
create or replace function reader_sweep_text(p_days int default 90, p_limit int default 5000)
returns int language plpgsql security invoker as $$
declare v_count int;
begin
  update reader_posts set text = null, text_swept_at = now()
   where id in (select id from reader_posts
                 where received_at < now() - make_interval(days => p_days)
                   and text is not null
                 order by id limit p_limit);
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

comment on function reader_sweep_text(int, int) is
  'Null the body of ONE batch of posts past the retention window and return how many. The caller
   (the Worker''s retention run) loops until it gets 0, so each batch is its own transaction: a
   catch-up run that trips statement_timeout keeps every batch it finished, where a plpgsql loop
   inside a single call would roll the whole statement back. The cutoff is computed from the
   DATABASE''s clock, never the caller''s, so a Worker with a skewed idea of now cannot widen it.
   Summaries are never swept — only the full text, which is kept solely so a post can be
   re-summarised.';

grant execute on function reader_sweep_text(int, int) to anon, authenticated, service_role;

-- No realtime publication line: nothing here is pushed to an open tab. The reading list is read
-- on load and after an action, as 0035 left it.

-- PostgREST caches the schema; the new views and function are invisible until it reloads.
notify pgrst, 'reload schema';
