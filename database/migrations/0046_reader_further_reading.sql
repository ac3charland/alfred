-- ═══════════════════════════════════════════════════════════════════════════
-- 0046 — A summarised post's Further reading links, and which of them were sent (ALF-289).
--
-- A summary's overview can now list the linked articles worth reading in full. The list itself
-- lives inside the existing reader_posts.overview jsonb, so it needs no column. What the database
-- does need is the record of which of those links the owner has already sent, and where:
--
--   1. reader_posts.further_sent_reader / further_sent_instapaper — the exact URLs sent to each
--      destination (the Reader's To Reader folder, or Instapaper's Unread).
--   2. append_further_reading_sent — one atomic append to the chosen destination's column.
--   3. A refreshed comment on reader_posts.html, which can now also hold an Instapaper article's
--      text-view HTML.
--
-- Expand-only: two new defaulted columns, one new function and a comment. Nothing is dropped or
-- renamed, so the app running while this applies is unaffected.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Which Further reading links a post has sent, per destination ─────────
-- Two columns rather than one, so the mark can say WHERE a link went ("In Reader" against "In
-- Instapaper"): a link is sent once, to one destination, and a URL in either array is out of the
-- selection. Exact URL, not an index, for the reason 0038 gives: a re-summarise rewrites the
-- list, and a reworded pick should read as unsent.
alter table reader_posts
  add column further_sent_reader     text[] not null default '{}',
  add column further_sent_instapaper text[] not null default '{}';

comment on column reader_posts.further_sent_reader is
  'The exact URL of every overview.further_reading item already sent to the Reader. An item shows '
  'as sent when its url is in this array; a re-summarise that drops a link drops its item, and a '
  'link it keeps keeps its mark.';

comment on column reader_posts.further_sent_instapaper is
  'The exact URL of every overview.further_reading item already sent to Instapaper''s Unread. An '
  'item shows as sent when its url is in this array; a re-summarise that drops a link drops its '
  'item, and a link it keeps keeps its mark.';

-- ── 2. The html column can hold an article's text view ──────────────────────
-- Same meaning as 0039 gave it, plus the Instapaper case.
comment on column reader_posts.html is
  'The email''s decoded text/html part, raw — no sanitising, no stripping of the mail''s chrome.
   Sent to Instapaper as the bookmark''s content; the app never renders it and the list payload
   never carries it. Written only when that HTML is what produced `text` (html_extracted) and it
   fits the Worker''s ceiling, so every row holding it also holds a non-empty `text` — which is
   what lets the retention sweep reach it. Null for every post ingested before this column
   existed; their sends fall back to the stored text. For an Instapaper article it is instead the
   HTML of Instapaper''s text view (get_text), kept so the article''s links reach the model and a
   Re-summarise can read them again.';

-- ── 3. Atomic append of a send's URLs to one destination ────────────────────
-- Adds only the URLs not already in the chosen destination's column, collapses duplicates, and
-- keeps first-occurrence order (the same rules as 0040's append_wiki_sent_picks). The subquery
-- reads the row's pre-update array, and the dedupe is against the chosen column only; the send
-- route is what refuses a URL already in the other column. An empty array appends nothing.
--
-- plpgsql rather than 0040's plain SQL: an unknown destination must raise, and a SQL function
-- cannot. Raising beats silently appending nowhere, which would let a typo look like a send.
--
-- `security invoker`: the route calls this as the authenticated owner under RLS, like 0040's.
create or replace function append_further_reading_sent(p_post uuid, p_destination text, p_urls text[])
returns setof reader_posts
language plpgsql security invoker as $$
begin
  if p_destination is null or p_destination not in ('reader', 'instapaper') then
    raise exception 'append_further_reading_sent: destination must be reader or instapaper, got %',
      coalesce(p_destination, 'null');
  end if;

  return query
  update reader_posts
     set further_sent_reader = case when p_destination = 'reader'
           then further_sent_reader || array(
             select u
               from unnest(p_urls) with ordinality as t(u, ord)
              where not (u = any(reader_posts.further_sent_reader))
              group by u
              order by min(ord)
           )
           else further_sent_reader end,
         further_sent_instapaper = case when p_destination = 'instapaper'
           then further_sent_instapaper || array(
             select u
               from unnest(p_urls) with ordinality as t(u, ord)
              where not (u = any(reader_posts.further_sent_instapaper))
              group by u
              order by min(ord)
           )
           else further_sent_instapaper end
   where id = p_post
  returning *;
end;
$$;

grant execute on function append_further_reading_sent(uuid, text, text[])
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
