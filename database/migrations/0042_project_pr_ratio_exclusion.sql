-- ═══════════════════════════════════════════════════════════════════════════
-- 0042 — Exclude a project from the Dashboard's PR ratio (ALF-276).
--
-- Every project is a measured repo on the merged-PR ratio card. This flag drops one from the
-- ratio: no segment, no share of the total, and never swept into Other either. Owner-flipped from
-- the card's ⋯ menu, so the exclude list changes without a deploy. Default false keeps every
-- existing and new project counting — no backfill. The lines-changed chart ignores it.
--
-- The knowledge repo ships excluded. The update is keyed on the repo, not an id, so it is a no-op
-- wherever that project doesn't exist (locally, in CI, or before it is created in production).
-- ═══════════════════════════════════════════════════════════════════════════

alter table projects
  add column exclude_from_pr_ratio boolean not null default false;

comment on column projects.exclude_from_pr_ratio is
  'ALF-276: true drops this project from the Dashboard PR ratio (no segment, not in the total, never counted as Other).';

update projects set exclude_from_pr_ratio = true
  where repo_owner = 'ac3charland' and repo_name = 'knowledge';
