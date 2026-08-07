---
branch: claude/db-migrations-merge-cicd-rjtymp
---

# Merging a migration applies it — to both instances (ALF-177)

*2026-08-07T20:45:06.222Z*

A migration reached production only when someone remembered to run `npm run migrate -w database <N>` against **both** Supabase projects. ALF-119 was that gap (0014 merged, never applied); ALF-124 was its grant-drift cousin. And because alfred runs as two physically-isolated instances with their own databases, the half-done version — Personal applied, Work forgotten — is just as available and quieter: the instance nobody tested keeps serving the old schema until it 500s.

Merging is migrating now. `.github/workflows/migrate.yml` runs on every push to `main`, one job per instance, over the session-pooler secrets the nightly backup already uses:

```bash
sed -n '/^on:/,/^    steps:/p' .github/workflows/migrate.yml
```

```output
on:
  push:
    branches: [main]
  workflow_dispatch: {} # manual runs (e.g. after provisioning an instance, or a re-run)

# The job only reads the repo; every database credential comes from a secret.
permissions:
  contents: read

jobs:
  migrate:
    # One job per isolated instance (each its own Supabase database), matching backup.yml.
    # fail-fast: false so a failure against one instance still lets the other reach the same schema.
    strategy:
      fail-fast: false
      matrix:
        instance: [personal, work]
    name: migrate (${{ matrix.instance }})
    runs-on: ubuntu-latest
    # Serialize per instance so two quick merges can't interleave their applies. The applier also
    # takes a Postgres advisory lock, which covers a manual `npm run migrate` racing this job.
    # cancel-in-progress: false — a cancelled apply is worse than a queued one.
    concurrency:
      group: db-migrate-${{ matrix.instance }}
      cancel-in-progress: false
    steps:
```

## What a merge actually does

Below is the real applier — the same `database/src/deploy.ts` the workflow runs — against two throwaway PostgreSQL databases standing in for Personal and Work. Both start exactly where the live ones are: the whole committed history applied by hand, and no ledger. On Work, the operator has *already* hand-applied the new migration, the habit this pipeline replaces.

```bash
node --no-warnings docs/demos/alf-177-merge-migrations/pipeline-run.mjs 2>/dev/null
```

```output

── a merge adds 0027_items_source_url_index.sql; what is pending, per instance ───
[personal] → target: 127.0.0.1:<port>
[personal] › no ledger yet on an existing database — recording 26 migrations through 0026_inbox_dispatch.sql as already applied
[personal] (dry run — nothing written; 1 migration(s) pending)
[personal]   would apply 0027_items_source_url_index.sql
[personal] pending: 1 migration(s), baselined: 26
[work] → target: 127.0.0.1:<port>
[work] (dry run — nothing written; 0 migration(s) pending)
[work] pending: 0 migration(s)

── the workflow runs — one job per instance ──────────────────────────────────
[personal] → target: 127.0.0.1:<port>
[personal] › no ledger yet on an existing database — recording 26 migrations through 0026_inbox_dispatch.sql as already applied
[personal] → applying 0027_items_source_url_index.sql…
[personal] ✓ applied 0027_items_source_url_index.sql
[personal] applied: 1 migration(s), baselined: 26
[work] → target: 127.0.0.1:<port>
[work] ✓ already up to date — nothing to apply
[work] applied: 0 migration(s)

── each database now records its own history ─────────────────────────────────
personal: 27 rows, last 3 —
  0025_story_requires_refinement.sql
  0026_inbox_dispatch.sql
  0027_items_source_url_index.sql
work: 27 rows, last 3 —
  0025_story_requires_refinement.sql
  0026_inbox_dispatch.sql
  0027_items_source_url_index.sql

── the index the migration created is really there (personal) ────────────────
  items_source_url_idx

── the next merge, with nothing new to apply ─────────────────────────────────
[personal] → target: 127.0.0.1:<port>
[personal] ✓ already up to date — nothing to apply
[personal] applied: 0 migration(s)
[work] → target: 127.0.0.1:<port>
[work] ✓ already up to date — nothing to apply
[work] applied: 0 migration(s)

── a broken migration fails the job instead of half-landing ──────────────────
[personal] → target: 127.0.0.1:<port>
[personal] → applying 0028_broken.sql…
deploy: relation "nope" does not exist
exit code: 1
rolled back: true, ledger rows for it: 0
```

Reading that top to bottom: Personal had no ledger, so its first run **recorded** the 26 migrations it already carried (through `0026_inbox_dispatch.sql`, the last one applied by hand) rather than replaying `0001`, then applied the one new file. Work had the same history *plus* the hand-applied migration — `npm run migrate` writes the same ledger, so the pipeline correctly applied nothing instead of running it twice. The second round of merges is a no-op on both. And a migration that fails takes nothing with it: no table, no ledger row, a red job.

## Answering "has *this* database seen it?"

The committed `database/migrations-applied.log` is a human paper trail of a shared history; it cannot say what any one instance has. So each database gets a `public.schema_migrations` ledger, and pending = the files it doesn't record. The deployer creates that table itself — it has to exist before the first migration can be judged, so it can't be a migration. Each file then runs in **one transaction with its ledger row**, which is what makes the failure above clean, and a `pg_advisory_lock` keeps a merge from racing a manual apply.

```bash
sed -n '/create table if not exists/,/^  `);/p' database/src/deploy.ts
```

```output
    create table if not exists ${LEDGER_TABLE} (
      filename   text primary key,
      applied_at timestamptz not null default now()
    );
    comment on table ${LEDGER_TABLE} is
      'Applied-migration ledger for THIS database, written by database/src/deploy.ts. applied_at is when the row was written — for baselined rows that is when the deployer first recognized the pre-existing history, not when the SQL originally ran. No grants: the API roles must never see it.';
  `);
```

It sits in `public` so it travels with the nightly `--schema public` dump (a restored database still knows its history), and it is deliberately left **ungranted** — `anon` and `authenticated` are denied, so it never surfaces through PostgREST. Both of those, plus the baseline, the idempotency, and the rollback above, are pinned in the database package's real-Postgres suite (`src/deploy-assertions.ts`).

## Operating it

No new secrets: the workflow reuses `SUPABASE_DB_URL_PERSONAL` / `SUPABASE_DB_URL_WORK`, the session-pooler URLs the backup job has been proving nightly. Watch a run under **Actions → Migrate Databases**; a red job emails the repo owner and leaves that instance — only that instance — behind until it's re-run. To see what a live database is missing without writing anything, `npm run deploy -w database -- --dry-run`.

One caveat worth stating: nothing orders this against Vercel's own deploy of `main`, so a migration can land moments after the code that wants it. Write migrations **expand-then-contract** — the new schema works with the code already live, and anything is dropped only in a later migration.
