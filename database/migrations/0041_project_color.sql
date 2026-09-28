-- ═══════════════════════════════════════════════════════════════════════════
-- 0041 — An owner-picked colour per project (ALF-188).
--
-- Until now a project's colour was derived, never stored: the app gives each project one of five
-- accents by its slot in creation order. This column lets the owner override that with a pick
-- from the same palette. NULL means Automatic — the creation-slot colour — so every existing row
-- keeps rendering exactly as before and nothing needs a backfill.
--
-- text + check rather than a Postgres enum, matching the key column's precedent: widening the
-- palette is one constraint swap, not an `alter type … add value` plus a type regeneration.
-- ═══════════════════════════════════════════════════════════════════════════

alter table projects
  add column color text
    check (color in ('blue', 'amber', 'green', 'red', 'teal'));

comment on column projects.color is
  'Owner-picked palette colour (ALF-188). NULL = automatic: the colour of the project''s creation slot.';
