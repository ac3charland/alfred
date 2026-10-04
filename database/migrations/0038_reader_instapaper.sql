-- alfred — sending a Reader post to Instapaper (ALF-238).
--
-- The reading list's primary verb stops being "open the original" and becomes "put this in my
-- Instapaper". The owner doesn't read sources where they live; they collect them in Instapaper
-- and read there. Three columns carry that:
--
--   * `html` — the email's own `text/html` part, which the intake already decodes to produce
--     `text` and then throws away. The send carries it as Instapaper's `content`, so a paid post
--     the owner subscribes to arrives in full rather than as the web paywall's teaser. Nothing in
--     the app renders it: the list payload never selects it and only the send route reads it.
--   * `instapaper_sent_at` — the last successful send, which is what the row's "in Instapaper"
--     badge is drawn from.
--   * `instapaper_bookmark_id` — Instapaper's own id for the saved bookmark. Nothing reads it
--     yet; it is stored so the planned Instapaper → wiki tag-sync has an identity to match a
--     pulled highlight back to the post it came from.
--
-- No new table, view or sequence, so there is nothing new to grant: `reader_posts`' existing RLS
-- and grants cover the three columns.

-- ── 1. reader_posts — the email HTML and the send's stamps ───────────────────
alter table reader_posts
  add column html                   text,
  add column instapaper_sent_at     timestamptz,
  add column instapaper_bookmark_id bigint;

comment on column reader_posts.html is
  'The decoded `text/html` part of the post''s email, raw — no sanitising and no stripping of the
   mail chrome (preheaders, "READ IN APP", the unsubscribe footer). Written by the intake only
   when that part is what produced `text` (`html_extracted`) and it fits the intake''s ceiling,
   so every row holding html also holds non-empty text. It exists for ONE reader: the send route,
   which passes it to Instapaper as the bookmark''s content and lets Instapaper''s own parser pull
   the article out of it, the same way its email-in feature handles a forwarded newsletter. The
   app never renders it and the list payload never selects it. Null for every post ingested
   before this column existed — those sends fall back to the stored text rendered as paragraphs.
   Swept with `text` at ninety days.';

comment on column reader_posts.instapaper_sent_at is
  'When the post was last saved to the owner''s Instapaper account. Stamped only once Instapaper
   confirms the save and returns a bookmark id — a failed send writes nothing at all, so this is
   never optimistic. Sending also archives the post, so a stamped row is normally an archived
   one; unarchiving it keeps the stamp, because the post is still in Instapaper.';

comment on column reader_posts.instapaper_bookmark_id is
  'Instapaper''s own id for the saved bookmark, as its add-bookmark response reports it. Nothing
   reads it yet: it is the identity the planned Instapaper tag-sync will match a pulled article
   and its highlights back to the post they came from. Re-sending a post overwrites it, which is
   correct — Instapaper moves an existing bookmark to the top of the list rather than duplicating
   it, so the newest id is the live one.';

-- ── 2. reader_sweep_text — the body sweep takes the HTML with it ─────────────
-- Same signature, same batching, same guards: one more column in the SET. The WHERE clause is
-- untouched and still keys on `text`, which is sound because the intake writes `html` only when
-- the HTML produced the stored text — so every row holding html is reached by the predicate that
-- finds its text, and the "never had a body" rule (an empty text is never stamped) is unchanged.
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
  'Null the body of ONE batch of posts past the retention window and return how many. The body is
   both columns: the stored `text` and the `html` the send reads, which are written together and
   are swept together. The caller (the Worker''s retention run) loops until it gets 0, so each
   batch is its own transaction: a catch-up run that trips statement_timeout keeps every batch it
   finished, where a plpgsql loop inside a single call would roll the whole statement back. The
   cutoff is computed from the DATABASE''s clock, never the caller''s, so a Worker with a skewed
   idea of now cannot widen it, and p_days below 1 raises rather than sweeping the whole table. A
   post with no body (null or empty text) is skipped entirely, so it is never stamped
   text_swept_at — "swept" and "never had one" are different answers and the app says different
   things about them. Summaries are never swept — only the full body, which is kept solely so a
   post can be re-summarised or sent.';

-- No realtime publication line and no new grants: nothing here is pushed to an open tab, and the
-- three columns ride `reader_posts`' existing RLS and grants.

-- PostgREST caches the schema; the replaced function is invisible until it reloads.
notify pgrst, 'reload schema';
