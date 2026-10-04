-- alfred — Reader: send a post to Instapaper (ALF-238).
--
-- The reading list's primary verb becomes "Send to Instapaper": one press saves the post to the
-- owner's Instapaper account and archives it here. The request carries the post's own email HTML,
-- so a paid post the owner subscribes to arrives whole rather than as the web paywall's teaser.
-- This migration is the schema half of that:
--
--   * `html` keeps the email's decoded text/html part, which intake already had in hand and threw
--     away after deriving `text` from it;
--   * `instapaper_sent_at` / `instapaper_bookmark_id` record a confirmed save — the row's
--     "in Instapaper" badge, and the identity a later Instapaper → wiki sync will match on;
--   * and the ninety-day sweep takes `html` with `text`, since the two are the same body twice.
--
-- No table, view or sequence is created, so there is nothing new to grant: the existing
-- `reader_posts` RLS policy and table grants cover new columns.

-- ── 1. reader_posts — the email HTML and the Instapaper stamp ─────────────────
alter table reader_posts
  add column html                   text,
  add column instapaper_sent_at     timestamptz,
  add column instapaper_bookmark_id bigint;

comment on column reader_posts.html is
  'The email''s decoded text/html part, raw: no sanitising and no stripping of the newsletter''s
   chrome, because Instapaper''s parser picks the article out and the app never renders it. Kept
   only when that part produced the stored text and fits the Worker''s ceiling, so a row with html
   always has non-empty text and the sweep reaches it. Null for posts ingested before it existed
   (their sends fall back to the text). Never in the list payload.';

comment on column reader_posts.instapaper_sent_at is
  'The last time Instapaper confirmed a save of this post. Written only on a confirmed save — a
   refused or failed send leaves the row untouched.';

comment on column reader_posts.instapaper_bookmark_id is
  'Instapaper''s bookmark id from the last confirmed save: the identity an Instapaper → wiki
   tag-sync matches its bookmarks back to posts by.';

-- ── 2. reader_sweep_text — the sweep takes the HTML with the text ─────────────
-- Same signature, batching and guards as 0036; the only change is one more column in the SET.
-- The WHERE clause is unchanged on purpose: intake writes `html` only when the HTML produced the
-- stored text, so every row holding html also holds non-empty text and is reached by it. `create
-- or replace` keeps the function's owner and its execute grants.
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
  'Null the body of ONE batch of posts past the retention window — the stored text and the email
   HTML it came from, together — and return how many. The caller (the Worker''s retention run)
   loops until it gets 0, so each batch is its own transaction: a catch-up run that trips
   statement_timeout keeps every batch it finished, where a plpgsql loop inside a single call
   would roll the whole statement back. The cutoff is computed from the DATABASE''s clock, never
   the caller''s, so a Worker with a skewed idea of now cannot widen it, and p_days below 1 raises
   rather than sweeping the whole table. A post with no body (null or empty text) is skipped
   entirely, so it is never stamped text_swept_at — "swept" and "never had one" are different
   answers and the app says different things about them. Summaries are never swept — only the
   bodies, which are kept solely so a post can be re-summarised or sent to Instapaper whole.';
