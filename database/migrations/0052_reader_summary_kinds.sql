-- ═══════════════════════════════════════════════════════════════════════════
-- 0052 — Summary kinds: a publication's type picks the summariser's prompt (ALF-322).
--
-- Not every newsletter is an essay. A link roundup's value is which of its links are worth
-- clicking; a shop's or a bank's mail is a needle-in-a-haystack, almost always noise. So each
-- publication carries a kind — essay (today's prompt, the default), roundup or alerts — and the
-- summariser asks that kind's question of its mail.
--
--   1. reader_publications.summary_kind — the kind the owner chose; every existing row reads essay.
--   2. reader_posts.summary_kind — the kind a post WAS summarised under, stamped beside
--      prompt_version. A post renders by this, never by its publication's current kind, so
--      changing a publication's kind changes no summary already written.
--   3. v_reader_publications — recreated to carry the new column (it lists its columns).
--
-- Both CHECKs are over new columns no deployed code writes yet, so applying this ahead of the
-- Worker and the app breaks nothing: the defaults are what every existing writer gets.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. The publication's kind ─────────────────────────────────────────────────
alter table reader_publications
  add column summary_kind text not null default 'essay',
  add constraint reader_publications_summary_kind_valid
      check (summary_kind in ('essay', 'roundup', 'alerts'));

comment on column reader_publications.summary_kind is
  'Which prompt the summariser reads this publication''s mail with. essay = the claim, the
   evidence and the argument (the default, and what every publication was before this column);
   roundup = the striking points in the issue and the links worth reading in full; alerts = only
   sales, security events, required actions and changes — a post with none is filed to the archive
   by the tick. Read on every summarise, so a Retry uses the kind as it is now.';

-- ── 2. The kind a post was summarised under ───────────────────────────────────
alter table reader_posts
  add column summary_kind text,
  add constraint reader_posts_summary_kind_valid
      check (summary_kind is null or summary_kind in ('essay', 'roundup', 'alerts'));

comment on column reader_posts.summary_kind is
  'The kind this post''s summary was written under, stamped by the tick in the same write as the
   summary and prompt_version — together they name the prompt. The overview''s shape follows it.
   Null = summarised before kinds existed (or not summarised yet), read as essay everywhere.';

-- ── 3. v_reader_publications — the roster with its kind ───────────────────────
-- An explicit column list (0036), so the view has to be recreated to expose the new column, and a
-- recreate drops the view's grants: they are re-granted below.
drop view v_reader_publications;

create view v_reader_publications with (security_invoker = true) as
  select p.id, p.handle, p.name, p.domain, p.enabled, p.source, p.notes,
         p.first_seen_at, p.created_at, p.summary_kind,
         max(r.received_at) as last_post_at
    from reader_publications p
    left join reader_posts r on r.publication_id = p.id
   group by p.id
   order by p.name;

grant select on v_reader_publications to anon, authenticated, service_role;

-- PostgREST caches the schema; the new columns are invisible until it reloads.
notify pgrst, 'reload schema';
