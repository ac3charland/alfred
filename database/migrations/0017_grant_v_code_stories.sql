-- Alfred — Restore the missing SELECT grant on v_code_stories (ALF-124).
--
-- Migration 0014 widened `code_items.priority` to `double precision`. Postgres pins a column's
-- type behind any view that selects it, so 0014 had to `drop view v_code_stories;` before the
-- `alter table … alter column … type`, then recreate the view. But `drop view` ALSO drops every
-- privilege granted on that view, and 0014 recreated it with a plain `create view` (not `create or
-- replace`, which preserves grants) WITHOUT re-issuing the `grant select` that 0002 originally gave
-- it. So the recreated view had no grant for the API roles.
--
-- `v_code_stories` is `security_invoker`, so the browser reads it as `authenticated` — which now
-- had no privilege on it. Every `select … from v_code_stories` (the GET /api/code list read behind
-- the whole Code view) failed with:
--
--   permission denied for view v_code_stories
--
-- That is PostgreSQL error 42501; the route's `mapSupabaseError` maps anything but 23505/23503 to
-- 500, so the Code view 500'd on every device. This is the view-grant analogue of the ALF-119
-- (0015) RPC 500 and the 0008 missing-sequence-grant 500 — a privilege dropped by a schema change,
-- not a logic bug.
--
-- Fix: re-grant SELECT to the three API roles (idempotent — safe to re-run) and reload the
-- PostgREST schema cache so the Data API serves the restored privilege immediately.

grant select on v_code_stories
  to anon, authenticated, service_role;

-- Reload PostgREST's schema cache so the restored grant is picked up immediately (a no-op when
-- nothing is listening, e.g. the integration cluster, so it is safe everywhere).
notify pgrst, 'reload schema';
