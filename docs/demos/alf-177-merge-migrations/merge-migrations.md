---
branch: claude/db-migrations-merge-cicd-rjtymp
---

# Merging a migration applies it — to both instances (ALF-177)

*2026-08-08T00:19:26.621Z*

A migration reached production only when someone remembered to run `npm run migrate -w database <N>` against **both** Supabase projects. ALF-119 was that gap (0014 merged, never applied); ALF-124 was its grant-drift cousin.

Building this proved the point harder than intended. Measured against a full local replay of the committed migrations, the two live databases were in **different** wrong states: **Work** was nine migrations behind (everything from `0018` on — habits, weekly plans, epic specs, inbox dispatch), and **Personal** had silently lost `0016`'s ALF-120 fix, so new code stories were landing at the global top of the Backlog instead of their project's top. Neither stood where a person would have guessed.

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

Below is the real applier — the same `database/src/deploy.ts` the workflow runs — against throwaway PostgreSQL databases seeded to the states the live ones were actually in: Personal carrying the full committed history, Work stopping at `0017`. Neither has a ledger yet.

```bash
node --no-warnings docs/demos/alf-177-merge-migrations/pipeline-run.mjs 2>/dev/null
```

```output

── an unadopted database: the deployer refuses to guess what it has ──────────
[work] → target: 127.0.0.1:<port>
deploy: this database has the app schema but no migration ledger, so what it has applied is unknown — refusing to guess. Verify its state, then adopt it once with --baseline <migration it stands at>; see database/README.md.
exit code: 1
wrote nothing: true

── adoption: one command, at the point the operator VERIFIED ─────────────────
[personal] → target: 127.0.0.1:<port>
[personal] › adopting this database at 0026_inbox_dispatch.sql — recording 26 migrations as already applied, on your word
[personal] ✓ already up to date — nothing to apply
[personal] applied: 0 migration(s), baselined: 26
[work] → target: 127.0.0.1:<port>
[work] › adopting this database at 0017_grant_v_code_stories.sql — recording 17 migrations as already applied, on your word
[work] → applying 0018_subtask_sort_order.sql…
[work] ✓ applied 0018_subtask_sort_order.sql
[work] → applying 0019_code_epics.sql…
[work] ✓ applied 0019_code_epics.sql
[work] → applying 0020_epic_specs.sql…
[work] ✓ applied 0020_epic_specs.sql
[work] → applying 0021_blocked_from.sql…
[work] ✓ applied 0021_blocked_from.sql
[work] → applying 0022_weekly_plans.sql…
[work] ✓ applied 0022_weekly_plans.sql
[work] → applying 0023_habits.sql…
[work] ✓ applied 0023_habits.sql
[work] → applying 0024_folder_sort_order.sql…
[work] ✓ applied 0024_folder_sort_order.sql
[work] → applying 0025_story_requires_refinement.sql…
[work] ✓ applied 0025_story_requires_refinement.sql
[work] → applying 0026_inbox_dispatch.sql…
[work] ✓ applied 0026_inbox_dispatch.sql
[work] applied: 9 migration(s), baselined: 17

── each database now records its own history ─────────────────────────────────
personal: 26 rows, last 3 —
  0024_folder_sort_order.sql
  0025_story_requires_refinement.sql
  0026_inbox_dispatch.sql
work: 26 rows, last 3 —
  0024_folder_sort_order.sql
  0025_story_requires_refinement.sql
  0026_inbox_dispatch.sql

── a merge adds 0027_items_source_url_index.sql — what is pending, per instance ───
[personal] → target: 127.0.0.1:<port>
[personal] (dry run — nothing written; 1 migration(s) pending)
[personal]   would apply 0027_items_source_url_index.sql
[personal] pending: 1 migration(s)
[work] → target: 127.0.0.1:<port>
[work] (dry run — nothing written; 1 migration(s) pending)
[work]   would apply 0027_items_source_url_index.sql
[work] pending: 1 migration(s)

── the workflow runs — one job per instance ──────────────────────────────────
[personal] → target: 127.0.0.1:<port>
[personal] → applying 0027_items_source_url_index.sql…
[personal] ✓ applied 0027_items_source_url_index.sql
[personal] applied: 1 migration(s)
[work] → target: 127.0.0.1:<port>
[work] → applying 0027_items_source_url_index.sql…
[work] ✓ applied 0027_items_source_url_index.sql
[work] applied: 1 migration(s)

── the index the migration created is really there, on both ──────────────────
  personal: items_source_url_idx
  work: items_source_url_idx

── the next merge, with nothing new to apply ─────────────────────────────────
[personal] → target: 127.0.0.1:<port>
[personal] ✓ already up to date — nothing to apply
[personal] applied: 0 migration(s)
[work] → target: 127.0.0.1:<port>
[work] ✓ already up to date — nothing to apply
[work] applied: 0 migration(s)

── a hand-applied migration is skipped, not run twice ────────────────────────
(applied 0028_items_notes_index.sql by hand on personal)
[personal] → target: 127.0.0.1:<port>
[personal] ✓ already up to date — nothing to apply
[personal] applied: 0 migration(s)

── a broken migration fails the job instead of half-landing ──────────────────
[work] → target: 127.0.0.1:<port>
[work] → applying 0028_items_notes_index.sql…
[work] ✓ applied 0028_items_notes_index.sql
[work] → applying 0029_broken.sql…
deploy: relation "nope" does not exist
exit code: 1
rolled back: true, ledger rows for it: 0
```

The first block is the one that matters: an **unadopted** database — schema but no ledger — is refused, loudly, with nothing written. That is the case both live databases were in, and the case where guessing a baseline would have recorded Work's nine missing migrations as applied and hidden them permanently. A red job is recoverable; a false ledger row is not.

Adoption is then a single deliberate command naming the point the operator **verified** the database stands at. Work's `--baseline 0017_grant_v_code_stories.sql` records the seventeen it has and applies the nine it doesn't — which is exactly the catch-up that was run against the real Work database. After that both are ordinary: a merge applies what's pending, a second run is a no-op, a hand-applied file is skipped rather than run twice, and a migration that fails takes nothing with it — no table, no ledger row, a red job.

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
      'Applied-migration ledger for THIS database, written by database/src/deploy.ts. applied_at is when the row was written — for rows recorded by a one-time --baseline adoption that is when the database was adopted, not when the SQL originally ran. No grants: the API roles must never see it.';
  `);
```

It sits in `public` so it travels with the nightly `--schema public` dump (a restored database still knows its history), and it is deliberately left **ungranted** — `anon` and `authenticated` are denied, so it never surfaces through PostgREST. Both of those, plus the refusal, the adoption, the idempotency and the rollback above, are pinned in the database package's real-Postgres suite (`src/deploy-assertions.ts`).

## Operating it

No new secrets: the workflow reuses `SUPABASE_DB_URL_PERSONAL` / `SUPABASE_DB_URL_WORK`, the session-pooler URLs the backup job has been proving nightly. Watch a run under **Actions → Migrate Databases**; a red job emails the repo owner and leaves that instance — only that instance — behind until it's re-run. To see what a live database is missing without writing anything, `npm run deploy -w database -- --dry-run`.

Both live databases have already been adopted and caught up (Work: `0018`–`0026`; Personal: `0016`), and `database/migrations-applied.log` records those applies — so the first real run of this workflow is a no-op on both. Adoption is not part of the merge path and never runs unattended.

One caveat worth stating: nothing orders this against Vercel's own deploy of `main`, so a migration can land moments after the code that wants it. Write migrations **expand-then-contract** — the new schema works with the code already running, and anything is dropped only in a later migration.
