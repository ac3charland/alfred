-- alfred — sending a Reader post to Instapaper (ALF-238).
--
-- The Reader's primary verb stops being "open the original" and becomes "put this in my
-- Instapaper". The send runs server-side in the app and carries the post's own body, so a paid
-- post the owner subscribes to arrives whole rather than as the web paywall's teaser. That needs
-- three things from the schema:
--
--   * the email's HTML, kept at intake — the stored `text` has lost the images, headings, lists
--     and links, and the owner reads in Instapaper, so the body sent there should read like the
--     post. Gmail credentials live only in the Worker, so the send cannot re-fetch it;
--   * when the post was last sent, which is what the row's "in Instapaper" badge draws from;
--   * and Instapaper's own id for the bookmark — the identity a later Instapaper → wiki sync keys on.
--
-- No new table, view or sequence: the existing `reader_posts` RLS and grants cover the columns.

-- ── 1. reader_posts — the email HTML and the send's stamps ──────────────────────
alter table reader_posts
  add column html                   text,
  add column instapaper_sent_at     timestamptz,
  add column instapaper_bookmark_id bigint;

comment on column reader_posts.html is
  'The email''s decoded text/html part, raw — no sanitising, no stripping of the mail''s chrome.
   Sent to Instapaper as the bookmark''s content; the app never renders it and the list payload
   never carries it. Written only when that HTML is what produced `text` (html_extracted) and it
   fits the Worker''s ceiling, so every row holding it also holds a non-empty `text` — which is
   what lets the retention sweep reach it. Null for every post ingested before this column
   existed; their sends fall back to the stored text.';

comment on column reader_posts.instapaper_sent_at is
  'The last time Instapaper confirmed it saved this post. Stamped only on a confirmed save —
   a refused or failed send writes nothing. Sending also archives the post, but this survives an
   unarchive: the post is still in Instapaper.';

comment on column reader_posts.instapaper_bookmark_id is
  'Instapaper''s bookmark_id for the saved post, from the same confirmed save. Unused by the app
   today; it is the identity an Instapaper → wiki sync matches a bookmark back to its post by.';

-- ── 2. reader_sweep_text — the retention sweep takes the HTML with the text ──────
-- Same signature, same guards, same batching as 0036; one more column in the SET. The WHERE
-- clause is deliberately unchanged: intake writes `html` only beside a non-empty `text`, so every
-- row holding HTML is already one the sweep reaches, and "never had a body" is still never
-- stamped.
create or replace function reader_sweep_text(p_days int default 90, p_limit int default 5000)
returns int language plpgsql security invoker as $$
declare v_count int;
begin
  -- The floor makes an obviously-wrong call loud rather than silent: `p_days => 0` would null
  -- every body in the table in one call, so it is a hard error rather than a clamp. It is NOT
  -- what stops an authenticated session from sweeping everything older than a day — `p_days => 1`
  -- is a legal call and would still do that. The real guard is that `anon` has no RLS policy on
  -- `reader_posts` (nothing to sweep as that role) and `authenticated` is the owner's own session,
  -- not an arbitrary caller — the same single-user trust boundary every other write in this
  -- schema stands on.
  if p_days < 1 then
    raise exception 'reader_sweep_text: p_days must be at least 1, got %', p_days;
  end if;
  if p_limit < 1 then
    raise exception 'reader_sweep_text: p_limit must be at least 1, got %', p_limit;
  end if;

  update reader_posts set text = null, html = null, text_swept_at = now()
   where id in (select id from reader_posts
                 where received_at < now() - make_interval(days => p_days)
                   and text is not null
                   and text <> ''
                 order by id limit p_limit);
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

comment on function reader_sweep_text(int, int) is
  'Null the body of ONE batch of posts past the retention window — `text` and `html` together —
   and return how many. The caller (the Worker''s retention run) loops until it gets 0, so each
   batch is its own transaction: a catch-up run that trips statement_timeout keeps every batch it
   finished, where a plpgsql loop inside a single call would roll the whole statement back. The
   cutoff is computed from the DATABASE''s clock, never the caller''s, so a Worker with a skewed
   idea of now cannot widen it, and p_days below 1 raises rather than sweeping the whole table. A
   post with no body (null or empty text) is skipped entirely, so it is never stamped
   text_swept_at — "swept" and "never had one" are different answers and the app says different
   things about them. `html` is only ever stored beside a non-empty `text`, so the same predicate
   reaches every row holding it. Summaries are never swept — only the bodies, which are kept
   solely so a post can be re-summarised or sent on.';

-- PostgREST caches the schema; the new columns are invisible to it until it reloads.
notify pgrst, 'reload schema';
