-- ═══════════════════════════════════════════════════════════════════════════
-- 0051 — A project's Claude Code cloud environment (ALF-279).
--
-- Every launch link opens claude.ai/code with the project's repo + a prefilled prompt. This column
-- names the cloud environment (its name or `env_…` id) the link preselects via the `environment`
-- query param, so each repo starts in the environment configured for it — its network policy,
-- setup script and secrets. Null omits the param and claude.ai/code falls back to its own pick.
-- Owner-edited on the board header and the new-project dialog; no backfill.
-- ═══════════════════════════════════════════════════════════════════════════

alter table projects
  add column cloud_environment text;

comment on column projects.cloud_environment is
  'ALF-279: the Claude Code cloud environment (name or id) launch links preselect; null leaves the choice to claude.ai/code.';
