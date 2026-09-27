-- ═══════════════════════════════════════════════════════════════════════════
-- 0040 — Sending a post's Evidence bullets to the wiki beside its Novel ideas (ALF-271).
--
-- 0038 let a post send picked Novel-ideas bullets into the wiki and recorded them in
-- wiki_sent_ideas. Evidence becomes a checklist too, and one send can carry bullets from both
-- sections as one commit, so the database needs:
--
--   1. reader_posts.wiki_sent_evidence — which Evidence bullets a post has sent, as exact text.
--   2. append_wiki_sent_picks — one atomic append to both lists, so a send is never half-marked.
--
-- append_wiki_sent_ideas is deliberately NOT dropped: migrations here are expand-then-contract,
-- and the app still running while this applies calls it. A later migration drops it once nothing
-- does.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Which Evidence bullets a post has sent ───────────────────────────────
-- Its own column rather than a share of wiki_sent_ideas: an idea and an evidence bullet with the
-- same text would otherwise mark each other as sent. Exact text, not indexes, for the reason 0038
-- gives: a re-summarise rewrites the list, and a reworded bullet should read as unsent.
alter table reader_posts add column wiki_sent_evidence text[] not null default '{}';

comment on column reader_posts.wiki_sent_evidence is
  'The exact text of every overview.evidence bullet already sent to the wiki. A bullet shows as '
  'sent when its text is in this array; an index would drift after a re-summarise rewrites the list.';

-- ── 2. Atomic append of a send's ideas and evidence ─────────────────────────
-- One UPDATE, so a send that carries both sections marks both or neither. Each array follows
-- append_wiki_sent_ideas's rules (copied from its current body in 0038): add only the strings not
-- already present, collapse duplicates, and keep first-occurrence order. The subqueries read the
-- row's pre-update arrays, so each list is checked against its own column only — an idea never
-- lands in wiki_sent_evidence, nor evidence in wiki_sent_ideas. An empty array appends nothing.
--
-- `security invoker`: the route calls this as the authenticated owner under RLS, like 0038's.
create or replace function append_wiki_sent_picks(p_post uuid, p_ideas text[], p_evidence text[])
returns setof reader_posts
language sql security invoker as $$
  update reader_posts
     set wiki_sent_ideas = wiki_sent_ideas || array(
           select i
             from unnest(p_ideas) with ordinality as t(i, ord)
            where not (i = any(reader_posts.wiki_sent_ideas))
            group by i
            order by min(ord)
         ),
         wiki_sent_evidence = wiki_sent_evidence || array(
           select e
             from unnest(p_evidence) with ordinality as t(e, ord)
            where not (e = any(reader_posts.wiki_sent_evidence))
            group by e
            order by min(ord)
         )
   where id = p_post
  returning *;
$$;

grant execute on function append_wiki_sent_picks(uuid, text[], text[])
  to anon, authenticated, service_role;
