---
branch: claude/backup-cicd-failure-bpr6m8
---

# The nightly backup stops reporting the migration ledger as drift

*2026-08-11T15:14:14.387Z*

The scheduled `Backup` workflow went red every night from 2026-08-08 onward — runs #17 through #21, both instances. The backup itself was never the problem: the dump was taken, it restored into the throwaway Postgres, and it reached R2. The run then failed on its *last* line, after both uploads had succeeded:

    uploaded daily/personal/2026-08-11.sql.gz
    uploaded monthly/personal/2026-08.sql.gz
    ✗ backup uploaded, but production is ahead of database/migrations — see the drift report above
    ##[error]Process completed with exit code 1.

The verifier reported exactly one drifted shape, every night, on both instances: `schema_migrations (whole table): filename, applied_at` — the deployer's own migration ledger. That drift can never be closed, because no migration is allowed to create it:

```bash
echo "migrations that create the ledger: $(grep -l schema_migrations database/migrations/*.sql | wc -l)"; echo; echo 'who creates it instead:'; grep -n 'create table if not exists' database/src/deploy.ts
```

```output
migrations that create the ledger: 0

who creates it instead:
124:    create table if not exists ${LEDGER_TABLE} (
```

The ledger has to exist *before* the first migration can be judged pending, so it is created by `database/src/deploy.ts` rather than by a migration. It still lives in `public`, though — deliberately, so a restored database knows its own history — which means every `--schema public` dump carries a `COPY public.schema_migrations` header. The verifier built its schema from `database/migrations` alone, so the one table the repo cannot express as a migration was the one table it could never build.

So here is the nightly's verify step, replayed against a real production-shaped database. `verify-parity.ts` (beside this doc) stands up a throwaway PostgreSQL cluster, brings one database up with `deployMigrations` — the same applier `migrate.yml` runs, ledger and all — takes a genuine `pg_dump --data-only --schema public` of it, and then judges that dump with the nightly's *own* drift functions and summary line. The verify schema is built two ways, differing by a single statement.

```bash
node docs/demos/backup-verifier-ledger/verify-parity.ts 2>/dev/null
```

```output
dump carries COPY headers for: projects, epics, folders, items, classification_corrections, code_items, habits, habit_entries, schema_migrations, weekly_plans

BEFORE — verify schema from database/migrations alone
  ⚠ production is AHEAD of database/migrations — the dump carries shapes the repo cannot build:
      schema_migrations (whole table): filename, applied_at
    The dump is sound; the VERIFIER is stale. migrate.yml applies on merge, so check, in
    order: is this a re-run replaying an older pinned commit? did a merge land mid-dump
    (db-backup-* and db-migrate-* are separate concurrency groups)? was a migration
    reverted, or DDL applied by hand outside the workflow?
  ✗ backup uploaded, but production is ahead of database/migrations — see the drift report above
  exit code: 1

AFTER  — verify schema from migrations + the deployer’s ledger
  ✓ backup complete
  exit code: 0
```

The BEFORE half is the CI failure verbatim, down to the wording of the drift report and the exit code. The AFTER half is the same dump, the same functions, one extra statement in the verify schema: `✓ backup complete`, exit 0.

The fix is that `backup.ts` now names what a deployed database's `public` schema actually is — the committed migrations **plus** the deployer's ledger — and builds the ledger by calling `ensureLedger` from `deploy.ts`, so it has one definition and a column added to it can't drift from a second copy. The drift check itself is untouched: nothing was excluded or silenced, so a genuinely stale verifier still reports, reconciles, uploads and exits non-zero exactly as before.
