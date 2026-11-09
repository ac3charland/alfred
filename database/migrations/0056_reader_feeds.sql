-- ═══════════════════════════════════════════════════════════════════════════
-- 0056 — RSS and Atom feeds as a fourth source of Reader posts (ALF-344).
--
-- The owner pastes a blog's feed URL on the publications page; the Worker's five-minute Reader
-- tick polls each feed hourly and each new entry lands in the reading list, summarised like a
-- newsletter. That needs:
--
--   1. reader_publications — a roster row is a mail sender (handle) XOR a feed (feed_url), plus
--      the feed's conditional-GET validators and its own health. A feed inherits the toggle, the
--      rename, the note and the summary kind with no second roster to keep in step.
--   2. reader_posts — `feed` as a fourth source, with the entry's identity unique per feed so the
--      insert is the claim a concurrent tick wins or loses on, as every other source's is.
--   3. v_reader_publications — recreated to carry the feed columns (it lists its columns).
--
-- A null handle never matches v_reader_worklist's join or v_reader_candidates' `not exists`, and
-- a unique column admits many nulls, so discovery's `on conflict (handle)` upsert is unaffected.
-- Expand-only for every existing writer: no deployed code writes a feed row or a feed post.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. reader_publications — a sender or a feed ─────────────────────────────
alter table reader_publications alter column handle drop not null;

alter table reader_publications
  add column feed_url             text unique,
  add column feed_etag            text,
  add column feed_last_modified   text,
  add column feed_checked_at      timestamptz,
  add column feed_last_success_at timestamptz,
  add column feed_last_error      text,
  add column feed_last_error_at   timestamptz,
  add constraint reader_publications_sender_xor_feed
      check ((handle is null) <> (feed_url is null));

comment on column reader_publications.handle is
  'The sender address a newsletter is matched on, lower-cased. Null for a feed, which is matched
   on feed_url instead; exactly one of the two is set.';

comment on column reader_publications.feed_url is
  'An RSS or Atom feed''s URL, as the owner pasted it, in the URL parser''s canonical form:
   trimmed, scheme and host lower-cased, the fragment dropped, the path and query otherwise kept
   (escaped where the parser escapes). Set only on a feed row — "is a feed" is always
   feed_url is not null. Checked to parse as a feed when it is added, never rewritten after.';

comment on column reader_publications.feed_etag is
  'The ETag of the feed''s last fully drained poll, sent back as If-None-Match. Null until then.';

comment on column reader_publications.feed_last_modified is
  'The Last-Modified of the feed''s last fully drained poll, sent back as If-Modified-Since.';

comment on column reader_publications.feed_checked_at is
  'When the tick last finished with this feed: a drained poll, a 304 or a failure. Null = never,
   which makes it due at once. A feed is due when it is enabled and this is null or over an hour
   old; a poll that left entries for the next tick does not stamp it, so the feed stays due.';

comment on column reader_publications.feed_last_success_at is
  'The feed''s last poll that read it (a drained poll or a 304). Its card''s "failing since"
   counts from here.';

comment on column reader_publications.feed_last_error is
  'Why the feed''s last failed poll failed, in the words its card quotes: "it answered 404",
   "it didn''t answer", "it isn''t an RSS or Atom feed any more", "it''s too large to read".';

comment on column reader_publications.feed_last_error_at is
  'When feed_last_error was written. The card shows the error while this is newer than
   feed_last_success_at (or there is no success yet).';

-- ── 2. reader_posts — the fourth source ─────────────────────────────────────
alter table reader_posts add column feed_entry_id text;

comment on column reader_posts.feed_entry_id is
  'A feed post''s identity within its feed: the Atom id, else the RSS guid, else the entry link,
   else a hash of its title and date. Unique per publication among feed posts, so an entry whose
   updated date moves is never imported twice. Null off-source.';

alter table reader_posts drop constraint reader_posts_source_valid;
alter table reader_posts add constraint reader_posts_source_valid
  check (source in ('gmail', 'instapaper', 'research', 'feed'));

comment on column reader_posts.source is
  'Where the post came from. gmail = a newsletter the tick read from the personal Gmail mirror;
   instapaper = an article the owner moved into the "To Reader" folder in Instapaper; research =
   a report a research Routine wrote; feed = an entry of an RSS or Atom feed on the roster.';

alter table reader_posts drop constraint reader_posts_source_identity;
alter table reader_posts add constraint reader_posts_source_identity check (
     (source = 'gmail'      and publication_id is not null and account_key is not null
                            and gmail_message_id is not null)
  or (source = 'instapaper' and instapaper_bookmark_id is not null
                            and comm_message_id is null
                            and account_key is null and gmail_message_id is null)
  or (source = 'research'   and publication_id is null and comm_message_id is null
                            and account_key is null and gmail_message_id is null)
  or (source = 'feed'       and publication_id is not null and feed_entry_id is not null
                            and comm_message_id is null
                            and account_key is null and gmail_message_id is null)
);

comment on constraint reader_posts_source_identity on reader_posts is
  'What each source requires. A newsletter keeps the whole mail identity it always had. An
   article carries its bookmark id and none of the mail identity; its publication_id is left
   free, so a later story can link it to a roster row without a migration of these rows. A
   research post carries none of the mail identity and no publication; its bookmark id is the
   one its Send saved, as on a newsletter. A feed post carries its feed (publication_id) and its
   entry id, and none of the mail identity.';

create unique index reader_posts_feed_source_key
  on reader_posts (publication_id, feed_entry_id) where source = 'feed';

-- ── 3. v_reader_publications — the roster with its feed columns ─────────────
-- An explicit column list (0036), so the view has to be recreated to expose the new columns, and
-- a recreate drops the view's grants: they are re-granted below.
drop view v_reader_publications;

create view v_reader_publications with (security_invoker = true) as
  select p.id, p.handle, p.name, p.domain, p.enabled, p.source, p.notes,
         p.first_seen_at, p.created_at, p.summary_kind,
         p.feed_url, p.feed_etag, p.feed_last_modified, p.feed_checked_at,
         p.feed_last_success_at, p.feed_last_error, p.feed_last_error_at,
         max(r.received_at) as last_post_at
    from reader_publications p
    left join reader_posts r on r.publication_id = p.id
   group by p.id
   order by p.name;

grant select on v_reader_publications to anon, authenticated, service_role;

-- PostgREST caches the schema; the new columns are invisible until it reloads.
notify pgrst, 'reload schema';
