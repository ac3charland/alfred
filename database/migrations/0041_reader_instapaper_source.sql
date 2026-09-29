-- alfred — Instapaper articles as a second source of Reader posts (ALF-272).
--
-- Until now every Reader post was a newsletter: a message in the personal Gmail mirror, matched
-- to a publication on the roster. The owner also saves articles to Instapaper from the web, and
-- moving one into an Instapaper folder named "To Reader" now brings it into the reading list,
-- summarised like a newsletter, by a new leg of the Worker's five-minute Reader tick. That needs:
--
--   * a discriminator on reader_posts, so a post says which source it came from — a synthetic
--     "Instapaper" publication would sit in the publications view with a toggle that does
--     nothing and claim to be a sender it isn't;
--   * the mail identity (publication, account, Gmail message) made optional, with a CHECK that
--     states what each source requires instead;
--   * the bookmark id as an Instapaper post's identity, unique among those posts, so the insert
--     is the claim a concurrent tick wins or loses on, exactly as (account_key, gmail_message_id)
--     is for mail;
--   * the article's site, normalised at intake, so a later story can link articles to the
--     publication that also mails them with one update keyed on it;
--   * and the leg's own health on the singleton row, apart from the summariser's, because a
--     dead Instapaper token is a third way for the Reader to go quiet and needs a third fix.
--
-- Expand-only: no table, view, sequence or function is added or replaced, so the existing
-- reader_posts / reader_health RLS and grants cover every column here. v_reader_worklist never
-- matches an article (it joins on the mail identity an article leaves null); v_reader_publications
-- counts an article toward a publication's last post only once something links the two, which is
-- what that link means; and reader_sweep_text keys on received_at, which for an article is the
-- instant the tick took it in.

-- ── 1. reader_posts — which source a post came from, and the article's site ─────
alter table reader_posts
  add column source text not null default 'gmail',
  add constraint reader_posts_source_valid check (source in ('gmail', 'instapaper'));

comment on column reader_posts.source is
  'Where the post came from. gmail = a newsletter the tick read from the personal Gmail mirror;
   instapaper = an article the owner moved into the "To Reader" folder in Instapaper. Defaults to
   gmail, so every row that predates this column is a newsletter, which it is.';

alter table reader_posts add column site text;

comment on column reader_posts.site is
  'The normalised host of an Instapaper post''s URL, written once at intake: lower-cased, a
   leading www. dropped, and a Substack app link (open.substack.com/pub/<name>/…) as
   <name>.substack.com — the domain discovery stores for that publication. Null for a newsletter
   and for a bookmark with no http(s) URL. The row''s eyebrow and the model''s Publication: line
   read it when the post has no linked publication, and a later story links articles to
   publications by it, never by re-parsing URLs.';

-- ── 2. reader_posts — the mail identity becomes the newsletter's alone ───────────
alter table reader_posts
  alter column publication_id   drop not null,
  alter column account_key      drop not null,
  alter column gmail_message_id drop not null;

alter table reader_posts add constraint reader_posts_source_identity check (
     (source = 'gmail'      and publication_id is not null and account_key is not null
                            and gmail_message_id is not null)
  or (source = 'instapaper' and instapaper_bookmark_id is not null
                            and comm_message_id is null
                            and account_key is null and gmail_message_id is null)
     -- publication_id is deliberately unconstrained for an Instapaper post: nothing sets it yet,
     -- and a later story links an article to the publication that also mails it by data alone.
);

comment on constraint reader_posts_source_identity on reader_posts is
  'What each source requires. A newsletter keeps the whole mail identity it always had. An
   article carries its bookmark id and none of the mail identity; its publication_id is left
   free, so a later story can link it to a roster row without a migration of these rows.';

comment on column reader_posts.publication_id is
  'The roster row that mailed this post. Required for a newsletter (reader_posts_source_identity);
   for an Instapaper article it is null until something links the article''s site to a
   publication, and then the row''s eyebrow and the model''s Publication: line use that
   publication''s name.';

comment on column reader_posts.account_key is
  'comm_accounts.key of the Gmail account the mail arrived on. Paired with gmail_message_id as a
   newsletter''s dedupe key; never comm_message_id, which changes if the comms row is ever purged
   and re-mirrored. Null for an Instapaper article, which is keyed on its bookmark id instead.';

comment on column reader_posts.gmail_message_id is
  'Gmail''s message id (comm_messages.source_id for a gmail account) — a newsletter''s
   per-message identity, paired with account_key. Never the comms row''s own id. Null for an
   Instapaper article.';

comment on column reader_posts.instapaper_bookmark_id is
  'Instapaper''s bookmark_id, with two meanings. On a newsletter it is the bookmark the Send verb
   created, from the save Instapaper confirmed. On an Instapaper article it is the post''s
   identity — the bookmark the tick took from To Reader — unique among those posts
   (reader_posts_instapaper_source_key), and Send moves that same bookmark back to Unread rather
   than saving a second one. Either way, the tick reads it to tell whether a bookmark in To Reader
   is already a post.';

-- ── 3. Indexes ────────────────────────────────────────────────────────────────
-- The claim: two ticks racing on one bookmark both insert, and the loser's 409 is its answer.
-- Partial, so a newsletter that was sent to Instapaper — and holds the same bookmark id once the
-- owner moves that bookmark into To Reader — never collides with anything.
create unique index reader_posts_instapaper_source_key
  on reader_posts (instapaper_bookmark_id) where source = 'instapaper';
-- The tick's "already a post?" read, across both sources.
create index reader_posts_instapaper_bookmark_idx
  on reader_posts (instapaper_bookmark_id) where instapaper_bookmark_id is not null;
-- No index on site yet: nothing filters on it. The story that links articles to publications
-- adds one if its update needs it.

-- ── 4. reader_health — the To Reader leg's own health ────────────────────────
alter table reader_health
  add column instapaper_last_success_at timestamptz,
  add column instapaper_last_error      text,
  add column instapaper_last_error_at   timestamptz;

comment on column reader_health.instapaper_last_success_at is
  'The last tick whose To Reader leg listed the folder and finished every bookmark it took with
   no Instapaper failure. Null until the leg first succeeds — and forever on a deployment
   without the Instapaper secrets, where the leg never runs.';

comment on column reader_health.instapaper_last_error is
  'The leg''s last Instapaper failure, in the owner''s words (a rejected credential, a missing
   "To Reader" folder, an Instapaper that didn''t answer). Kept apart from last_error, which is
   the summariser''s: newsletters still flow while Instapaper refuses alfred. Newer than
   instapaper_last_success_at means articles are waiting in To Reader.';

comment on column reader_health.instapaper_last_error_at is
  'When instapaper_last_error was written. A failing leg re-stamps it every tick, which is why
   the app counts how long Instapaper has been failing from the last success instead.';

-- PostgREST caches the schema; the new columns are invisible to it until it reloads.
notify pgrst, 'reload schema';
