-- ═══════════════════════════════════════════════════════════════════════════
-- 0038 — Reader → Instapaper: keep the email's HTML, and record a send (ALF-238)
--
-- The Reader row's primary verb sends a post to the owner's Instapaper account. The request
-- carries the post's own email HTML, so a paid post arrives in full rather than as the web
-- paywall's teaser — which means intake has to keep that HTML instead of discarding it.
--
--   1. Three columns on `reader_posts`: the HTML body, when the last successful send landed, and
--      the bookmark id Instapaper answered with.
--   2. `reader_sweep_text` nulls `html` in the same statement that nulls `text`.
--
-- No new table, view or sequence: the existing `reader_posts` RLS and grants cover the columns.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The columns ──────────────────────────────────────────────────────────
-- `html` is written only when the HTML part produced the stored prose (`html_extracted`), so every
-- row holding `html` also holds non-empty `text` — which is what lets the sweep's unchanged WHERE
-- clause reach it. Never in the list payload: the app never renders it, only the send route reads
-- it.
alter table reader_posts
  add column html text,
  add column instapaper_sent_at timestamptz,
  add column instapaper_bookmark_id bigint;

comment on column reader_posts.html is
  'The email''s decoded text/html part, raw, kept so a send to Instapaper carries the full post.
   Null for a plain-text post, one past the stored-HTML ceiling, one ingested before 0038, or one
   whose body the retention sweep took.';
comment on column reader_posts.instapaper_sent_at is
  'When the last successful send to Instapaper landed. Null = never sent.';
comment on column reader_posts.instapaper_bookmark_id is
  'The bookmark id Instapaper answered the last send with — the identity a later Instapaper sync
   matches on.';

-- ── 2. reader_sweep_text — one batch of the ninety-day sweep, now taking html too ─
-- Same signature, batching and guards as 0036; one more column in the SET.
create or replace function reader_sweep_text(p_days int default 90, p_limit int default 5000)
returns int language plpgsql security invoker as $$
declare v_count int;
begin
  -- See 0036 for why these floors raise rather than clamp, and what actually guards the sweep.
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
  'Null the body (text AND html) of ONE batch of posts past the retention window and return how
   many. The caller (the Worker''s retention run) loops until it gets 0, so each batch is its own
   transaction: a catch-up run that trips statement_timeout keeps every batch it finished, where a
   plpgsql loop inside a single call would roll the whole statement back. The cutoff is computed
   from the DATABASE''s clock, never the caller''s, so a Worker with a skewed idea of now cannot
   widen it, and p_days below 1 raises rather than sweeping the whole table. A post with no body
   (null or empty text) is skipped entirely, so it is never stamped text_swept_at — "swept" and
   "never had one" are different answers and the app says different things about them. html is
   only ever stored beside non-empty text, so the same predicate reaches it. Summaries are never
   swept — only the bodies, kept so a post can be re-summarised or sent to Instapaper.';

grant execute on function reader_sweep_text(int, int) to anon, authenticated, service_role;

-- PostgREST caches the schema; the new columns are invisible until it reloads.
notify pgrst, 'reload schema';
