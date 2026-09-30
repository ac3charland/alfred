-- ═══════════════════════════════════════════════════════════════════════════
-- 0042 — Comms: an end state for a re-run that can't succeed (ALF-221).
--
-- A re-run of an already-judged row that keeps failing with a bad model response used to retry
-- forever: the worklist did not look at `classify_attempts`, and the at-ceiling park only picks
-- up rows with no tier. The Worker now gives such a request up at the attempt ceiling, keeping
-- the old verdict, and stamps this column so the owner can be told.
--
-- Nullable, no default: NULL is every row that has never had a failed re-run, so nothing needs a
-- backfill and the deployed frontend, which ignores the column, keeps working.
-- ═══════════════════════════════════════════════════════════════════════════

alter table comm_messages add column reclassify_failed_at timestamptz;

comment on column comm_messages.reclassify_failed_at is
  'When the Worker gave up on an explicit re-run request after the attempt ceiling of content-shaped
   failures; the previous tier, verdict and ask stand. NULL = no failed re-run. Cleared by the next
   request, so a set value always describes the latest one.';
