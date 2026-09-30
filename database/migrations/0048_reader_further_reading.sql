-- ═══════════════════════════════════════════════════════════════════════════
-- 0048 — A summarised post's "Further reading": the linked sources worth reading in full,
-- sendable to the Reader or to Instapaper (ALF-289).
--
-- The list itself rides in the existing `overview` jsonb as `further_reading` ({ url, title,
-- note } items), so it needs no column. What the database needs is which of those links the owner
-- has already sent, and where:
--
--   1. reader_posts.further_sent_reader / further_sent_instapaper — sent links, by exact URL.
--   2. append_further_reading_sent — one atomic append to one of the two, deduplicated.
--   3. The html column's comment: an Instapaper article's row now keeps get_text's HTML too.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Which links a post has sent, and where ───────────────────────────────
-- Exact URLs rather than indexes, for the reason 0038 gives for bullets: a re-summarise rewrites
-- the list, and a link it keeps should keep its mark while one it drops takes its mark with it.
-- Two columns rather than one tagged list: a link is sent once, to one place, and the row reads
-- which place without parsing anything.
alter table reader_posts
  add column further_sent_reader text[] not null default '{}',
  add column further_sent_instapaper text[] not null default '{}';

comment on column reader_posts.further_sent_reader is
  'The exact URL of every overview.further_reading link sent to the Reader (saved into the '
  'Instapaper "To Reader" folder the Worker takes articles from).';

comment on column reader_posts.further_sent_instapaper is
  'The exact URL of every overview.further_reading link saved to Instapaper''s Unread.';

-- ── 2. Atomic append to one destination's list ──────────────────────────────
-- One UPDATE: add only the URLs not already in the chosen column, collapse duplicates, keep
-- first-occurrence order — append_wiki_sent_picks's rules (0040), for one column picked by name.
-- A destination other than the two raises rather than silently appending nowhere.
--
-- plpgsql rather than sql only for the raise; `security invoker`, so the route calls it as the
-- authenticated owner under RLS, like 0040's.
create or replace function append_further_reading_sent(
  p_post uuid,
  p_destination text,
  p_urls text[]
)
returns setof reader_posts
language plpgsql security invoker as $$
begin
  if p_destination is null or p_destination not in ('reader', 'instapaper') then
    raise exception 'append_further_reading_sent: unknown destination %', p_destination
      using errcode = '22023';
  end if;

  return query
  update reader_posts
     set further_sent_reader = case
           when p_destination = 'reader' then further_sent_reader || array(
             select u
               from unnest(p_urls) with ordinality as t(u, ord)
              where not (u = any(reader_posts.further_sent_reader))
              group by u
              order by min(ord)
           )
           else further_sent_reader
         end,
         further_sent_instapaper = case
           when p_destination = 'instapaper' then further_sent_instapaper || array(
             select u
               from unnest(p_urls) with ordinality as t(u, ord)
              where not (u = any(reader_posts.further_sent_instapaper))
              group by u
              order by min(ord)
           )
           else further_sent_instapaper
         end
   where id = p_post
  returning *;
end;
$$;

grant execute on function append_further_reading_sent(uuid, text, text[])
  to anon, authenticated, service_role;

-- ── 3. The HTML column now holds an article's too ───────────────────────────
-- 0047's wording, extended with the Instapaper article: copied from its current text, not 0039's.
comment on column reader_posts.html is
  'The email''s decoded text/html part, raw — no sanitising, no stripping of the mail''s chrome
   — or, for a research post, the report rendered from `text` at delivery (raw HTML in the
   markdown dropped), or, for an Instapaper article, get_text''s HTML. A newsletter''s and a
   research post''s are sent to Instapaper as the bookmark''s content; an article''s is kept only
   so its links reach the summariser, and its Send re-saves by URL and never uploads it. The app
   never renders it and the list payload never carries it. Written only beside a non-empty
   `text`, which is what lets the retention sweep reach it. Null for every post ingested before
   it was kept; their sends fall back to the stored text.';

notify pgrst, 'reload schema';
