---
branch: alf-41-realtime-code-items
---

# ALF-41 — code_items joins the supabase_realtime publication

*2026-06-22T19:29:37.912Z*

**What & why.** The Software Factory board groups stories into swimlanes by `code_items.factory_state`, but that column is written *out of band* by the webhook Worker (PR opened/merged → state transition). With the board seeded once at the layout, those Worker writes never reach an open tab. Migration `0003_realtime_code_items.sql` adds `code_items` to the `supabase_realtime` publication so the browser can subscribe to row changes and move cards live.

This demo covers the **migration slice only** — the schema/publication change. The frontend subscription, notifications, and tests (spec §2–§6) are a separate slice and are **not** in this PR.

The shipped DDL — a single, idempotent-by-intent publication change (no new RLS policy, no `database.types.ts` change, since publication membership is not part of the generated types):

```bash
cat database/migrations/0003_realtime_code_items.sql
```

```output
-- Story swimlanes update live: stream code_items row changes to the open Code board.
-- factory_state is written out-of-band by the webhook Worker, so the browser needs a
-- push channel to reflect PR-driven transitions without a reload.
--
-- Realtime delivers nothing until a table joins the supabase_realtime publication. RLS
-- still governs the stream: code_items already has the `authenticated full access` policy
-- (using (true)) from 0002, so an authenticated browser (anon key + session) receives
-- changes; no new policy and no database.types.ts regeneration are required.
alter publication supabase_realtime add table code_items;
```

**Applied & verified against the live project** (credentialed, local — the only way to touch Realtime; a CI/web sandbox has no `.env.local`, per spec §1). Connecting over the session pooler with a one-off `pg` client, checking publication membership *before* and *after* applying the DDL:

> Connecting to: postgresql://postgres.pobfpuohktigmnkcqwga:****@aws-1-us-east-2.pooler.supabase.com:5432/postgres
> Database: postgres
> Server  : PostgreSQL 17.6 on aarch64-unknown-linux-gnu
>
> BEFORE: code_items in supabase_realtime publication? false
> Applying 0003_realtime_code_items.sql ...
> AFTER : code_items in supabase_realtime publication? true
>
> ✓ Applied. code_items now streams realtime changes.

`BEFORE = false → AFTER = true` is the proof: `code_items` was not a member, and is now. The membership query is `select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'code_items'`. Re-running the apply is a safe no-op (it now reports "already a member"), so the closeout step is idempotent.
