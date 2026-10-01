-- ═══════════════════════════════════════════════════════════════════════════
-- 0046 — A post's Further reading: the linked sources worth reading in full (ALF-289).
--
-- The summariser now returns, inside the existing overview jsonb, a short list of the links a
-- post rests on or recommends (overview.further_reading: [{ url, title, note }]). The owner ticks
-- some and sends them to Instapaper — into its "To Reader" folder, where the Reader picks them up
-- and summarises them, or straight to Unread. The database needs:
--
--   1. reader_posts.further_sent_reader / further_sent_instapaper — which links a post has sent
--      where, as exact URLs.
--   2. append_further_reading_sent — one atomic append to either list.
--   3. A corrected comment on reader_posts.html, which now also holds an Instapaper article's
--      text view, so an article's links reach the summariser too.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Which links a post has sent, and where ───────────────────────────────
-- Exact URLs rather than indexes, for the reason 0038 gives for bullets: a re-summarise rewrites
-- the list, and a link it keeps should keep its mark while one it drops should drop with it. Two
-- columns rather than one tagged list, so each send appends to exactly one and a link sent to the
-- Reader can never read as sent to Unread.
alter table reader_posts
  add column further_sent_reader text[] not null default '{}',
  add column further_sent_instapaper text[] not null default '{}';

comment on column reader_posts.further_sent_reader is
  'The exact URL of every overview.further_reading item saved into Instapaper''s "To Reader" '
  'folder, where the Reader takes it in and summarises it.';
comment on column reader_posts.further_sent_instapaper is
  'The exact URL of every overview.further_reading item saved straight to Instapaper''s Unread.';

-- ── 2. Atomic append of one send's URLs ─────────────────────────────────────
-- One UPDATE on one of the two columns, with append_wiki_sent_picks's rules (0040): add only the
-- URLs not already present, collapse duplicates, keep first-occurrence order. Any destination but
-- the two raises, so a typo in a caller can never append to nothing and report success.
--
-- `security invoker`: the route calls this as the authenticated owner under RLS, like 0040's.
create or replace function append_further_reading_sent(
  p_post uuid,
  p_destination text,
  p_urls text[]
)
returns setof reader_posts
language plpgsql security invoker as $$
begin
  if p_destination = 'reader' then
    return query
      update reader_posts
         set further_sent_reader = further_sent_reader || array(
               select u
                 from unnest(p_urls) with ordinality as t(u, ord)
                where not (u = any(reader_posts.further_sent_reader))
                group by u
                order by min(ord)
             )
       where id = p_post
      returning *;
  elsif p_destination = 'instapaper' then
    return query
      update reader_posts
         set further_sent_instapaper = further_sent_instapaper || array(
               select u
                 from unnest(p_urls) with ordinality as t(u, ord)
                where not (u = any(reader_posts.further_sent_instapaper))
                group by u
                order by min(ord)
             )
       where id = p_post
      returning *;
  else
    raise exception 'unknown further-reading destination: %', p_destination
      using errcode = '22023';
  end if;
end;
$$;

grant execute on function append_further_reading_sent(uuid, text, text[])
  to anon, authenticated, service_role;

-- ── 3. reader_posts.html can be an Instapaper article's text view ───────────
comment on column reader_posts.html is
  'The post''s raw HTML — no sanitising, no stripping. For a newsletter, the email''s decoded
   text/html part, sent to Instapaper as the bookmark''s content; for an Instapaper article,
   get_text''s HTML (its text view), kept only so the summariser can see the article''s links — an
   article''s Send re-saves by URL and never uploads it. The app never renders it and the list
   payload never carries it. Written only when that HTML is what produced `text` and it fits the
   Worker''s ceiling, so every row holding it also holds a non-empty `text` — which is what lets
   the retention sweep reach it. Null for every post ingested before it was kept.';

notify pgrst, 'reload schema';
