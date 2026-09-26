-- ═══════════════════════════════════════════════════════════════════════════
-- 0038 — The wiki module (ALF-261): Alfred's two ends of the knowledge wiki.
--
-- The wiki itself lives in a private git repo, not here. Alfred only (a) commits source folders
-- into that repo's inbox/ — picked Reader bullets, dispatched knowledge captures — and (b) reads a
-- snapshot of the repo's compiled pages. This migration holds everything the database needs for
-- both directions:
--
--   1. reader_posts.wiki_sent_ideas — which "Novel ideas" bullets a post has already sent, stored
--      as the bullets' exact text (a bullet has no id, and a re-summarise rewrites the list).
--   2. append_wiki_sent_ideas — one atomic append, so two sends from two tabs can't erase each
--      other's marks with a read-modify-write.
--   3. wiki_pages + wiki_sync — the page snapshot the Worker reconciles from the repo tree and
--      the module reads, with a full-text index for body search.
--   4. items_dispatched_needs_folder relaxed for knowledge — a knowledge row leaves the Inbox for
--      the wiki, never a folder, exactly like a code row leaves for the factory.
--   5. send_items_to_wiki — stamp dispatched_at (which fires the corrections log), then delete.
--   6. search_wiki_pages — ranked body search with control-character snippet delimiters.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Which Novel-ideas bullets a post has sent ────────────────────────────
-- The bullets' exact strings rather than indexes: `overview.novel_ideas` is a bare string list
-- with no ids, and a re-summarise rewrites the whole list, so an index would point at the wrong
-- bullet afterwards. A reworded bullet reads as unsent (its text is no longer in the array) and
-- the old strings stay behind harmlessly.
alter table reader_posts add column wiki_sent_ideas text[] not null default '{}';

comment on column reader_posts.wiki_sent_ideas is
  'The exact text of every overview.novel_ideas bullet already sent to the wiki. A bullet shows as '
  'sent when its text is in this array; an index would drift after a re-summarise rewrites the list.';

-- ── 2. Atomic append of sent ideas ───────────────────────────────────────────
-- One UPDATE that adds only the strings not already present. The UI allows one send per post at
-- a time, but two tabs or two devices can still race, and a read-modify-write in the route would
-- let the later send erase the earlier send's bullets. Duplicates within `p_ideas` are collapsed
-- too, so a request that names one bullet twice records it once.
--
-- `security invoker`: the browser calls this as the authenticated owner under RLS, exactly like
-- the row's other PATCHes.
--
-- `select distinct` dedupes but does not promise to preserve `p_ideas`' order — Postgres is free
-- to answer in whatever order its dedupe plan finds convenient, which happened to look
-- alphabetical in testing but is not a documented guarantee. `unnest ... with ordinality` names
-- each element's position, `group by` dedupes on the string, and `order by min(ordinality)`
-- appends in first-occurrence order deterministically, every time.
create or replace function append_wiki_sent_ideas(p_post uuid, p_ideas text[])
returns setof reader_posts
language sql security invoker as $$
  update reader_posts
     set wiki_sent_ideas = wiki_sent_ideas || array(
           select i
             from unnest(p_ideas) with ordinality as t(i, ord)
            where not (i = any(reader_posts.wiki_sent_ideas))
            group by i
            order by min(ord)
         )
   where id = p_post
  returning *;
$$;

grant execute on function append_wiki_sent_ideas(uuid, text[]) to anon, authenticated, service_role;

-- ── 3. The page snapshot ─────────────────────────────────────────────────────
-- Only the compiled pages (wiki/<section>/<name>.md) are snapshotted; raw sources stay in the
-- repo and open on GitHub. Written only by the Worker (service role, on a push to the wiki's
-- main and on the daily safety-net cron); read by the app as the authenticated owner.
--
-- `blob_oid` is the git blob the row was parsed from: the Worker diffs the repo tree's oids
-- against this column, so an unchanged page costs nothing and a rename is a delete plus an
-- insert. `links` holds the page's outbound wiki-page paths, which is what backlinks are
-- computed from client-side.
create table wiki_pages (
  path        text primary key,
  section     text not null,
  title       text not null,
  summary     text not null default '',
  tags        text[] not null default '{}',
  sources     text[] not null default '{}',
  links       text[] not null default '{}',
  created     date,
  updated     date,
  body        text not null default '',
  parse_error text,
  blob_oid    text not null,
  commit_oid  text not null,
  synced_at   timestamptz not null default now(),
  -- Title outranks summary outranks body, so a page ABOUT the query sorts above a page that
  -- merely mentions it.
  search      tsvector generated always as (
                setweight(to_tsvector('english', title), 'A') ||
                setweight(to_tsvector('english', summary), 'B') ||
                setweight(to_tsvector('english', body), 'C')) stored,

  constraint wiki_pages_section_valid check (
    section in ('concepts', 'entities', 'sources', 'questions')
  ),
  constraint wiki_pages_path_in_section check (
    path like 'wiki/' || section || '/%.md'
  )
);

comment on column wiki_pages.path is
  'The repo path, wiki/<section>/<name>.md — the identity a link resolves to.';
comment on column wiki_pages.links is
  'Outbound wiki-page paths the body links to, resolved and deduped by the Worker. Backlinks are '
  'every page whose links contain this path. A target that does not exist is kept: a backlink does '
  'not care whether its target has been written yet.';
comment on column wiki_pages.parse_error is
  'Set when the frontmatter was not valid YAML or the blob was binary or truncated; the body then '
  'holds the raw text (or nothing) rather than a parsed page.';

create index wiki_pages_search_idx on wiki_pages using gin (search);

-- A singleton: when the snapshot last reconciled, against which commit, how many changed pages
-- it left for the next run (the per-run cap), and the last failure if the most recent run threw.
-- `last_error_at` newer than `synced_at` is what the module reads as "the last sync failed".
create table wiki_sync (
  id            int primary key default 1,
  commit_oid    text,
  synced_at     timestamptz,
  pending       int not null default 0,
  last_error    text,
  last_error_at timestamptz,

  constraint wiki_sync_singleton check (id = 1),
  constraint wiki_sync_pending_not_negative check (pending >= 0)
);

-- RLS + GRANTs, the 0035 template: the authenticated owner has full access, anon is denied (no
-- policy), and the service role bypasses RLS by design — that is the Worker's write path. Raw
-- `psql -f` gets none of Supabase's auto-grants, so DML is granted explicitly. No realtime: the
-- snapshot changes a few times a day and the module re-reads it on navigation and tab return.
alter table wiki_pages enable row level security;
alter table wiki_sync  enable row level security;

create policy "authenticated full access" on wiki_pages
  for all to authenticated using (true) with check (true);
create policy "authenticated full access" on wiki_sync
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on wiki_pages to anon, authenticated, service_role;
grant select, insert, update, delete on wiki_sync  to anon, authenticated, service_role;

-- ── 4. A knowledge row may be dispatched without a folder ────────────────────
-- 0026's CHECK requires a dispatched row to hold a folder unless it is code (which leaves for
-- the factory). A knowledge row leaves for the wiki the same way, so it is exempt too. The
-- constraint is recreated rather than altered — Postgres has no `alter constraint` for a CHECK.
alter table items drop constraint items_dispatched_needs_folder;
alter table items add constraint items_dispatched_needs_folder check (
  dispatched_at is null or folder_id is not null or item_type in ('code', 'knowledge')
);

-- ── 5. Dispatch knowledge rows to the wiki: stamp, then delete ───────────────
-- Taking an item out of Alfred is a hard delete — the wiki is the record from then on. But the
-- classifier's learning loop (the corrections trigger in 0029) only fires when dispatched_at goes
-- from null to set, so the RPC stamps first — which logs any correction such as "the classifier
-- said task, the owner said knowledge" — and only then deletes. The correction row survives the
-- delete with item_id null (its own `on delete set null`), which is what makes it a lesson rather
-- than a reference. convert_to_code_epic is the precedent for consume-and-delete.
--
-- All-or-nothing: every id must be a root, undispatched, childless knowledge row, or nothing is
-- stamped. The route validates the same shape first and answers 409 with the offending id; this
-- guard is what holds at the instant of the write.
create or replace function send_items_to_wiki(p_ids uuid[]) returns int
language plpgsql security invoker as $$
declare
  v_bad   uuid;
  v_count int;
begin
  select id into v_bad from unnest(p_ids) as wanted(id)
   where not exists (
     select 1 from items i
      where i.id = wanted.id
        and i.item_type = 'knowledge'
        and i.parent_id is null
        and i.dispatched_at is null
   )
   limit 1;
  if v_bad is not null then
    raise exception 'send_items_to_wiki: % is not an undispatched root knowledge item', v_bad
      using errcode = 'check_violation';
  end if;

  select parent_id into v_bad from items where parent_id = any(p_ids) limit 1;
  if v_bad is not null then
    raise exception 'send_items_to_wiki: % has subtasks', v_bad
      using errcode = 'check_violation';
  end if;

  update items set dispatched_at = now() where id = any(p_ids);
  delete from items where id = any(p_ids);
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

grant execute on function send_items_to_wiki(uuid[]) to anon, authenticated, service_role;

-- ── 6. Body search ───────────────────────────────────────────────────────────
-- Ranked full-text search over the snapshot, for the module's "In page text" group. The snippet
-- marks each matched word with chr(2) / chr(3), which never occur in markdown, so the client can
-- split the string into highlight spans without ever injecting HTML from the server.
create or replace function search_wiki_pages(p_query text, p_limit int default 20)
returns table (path text, snippet text, rank real)
language sql stable security invoker as $$
  select p.path,
         ts_headline('english', p.body, q,
           'StartSel=' || chr(2) || ', StopSel=' || chr(3) ||
           ', MaxWords=24, MinWords=10, MaxFragments=1') as snippet,
         ts_rank(p.search, q) as rank
    from wiki_pages p, websearch_to_tsquery('english', p_query) as q
   where p.search @@ q
   order by rank desc, p.path
   limit p_limit;
$$;

grant execute on function search_wiki_pages(text, int) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
