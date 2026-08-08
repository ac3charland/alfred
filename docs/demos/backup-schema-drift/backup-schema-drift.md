---
branch: claude/backup-ci-dispatched-at-error-ox4qar
---

# The nightly backup survives a production database migrated ahead of the repo

*2026-08-07T19:47:22.801Z*

The scheduled `Backup` run went red on 2026-08-07 with `ERROR: column "dispatched_at" of relation "items" does not exist`, and no backup was uploaded for the `personal` instance that day.

The dump was fine — 628 KB, gzipped, structurally sound. What failed was the *verifier*. The backup dumps production, then rebuilds a throwaway schema from `database/migrations` and loads the dump's data into it. That silently assumes the repo and production are in lockstep. On the day it broke they weren't: migration `0026` was applied to the live database at 02:12Z and merged to `main` later the same day, and the scheduled job checked out `main` at `6a157f9` — migrations stopping at `0025` — so production's `COPY` carried a column the repo could not build, psql aborted, and the job died before the upload.

`migrate.yml` now applies migrations on merge, so the repo is normally at or ahead of production and that particular ordering is gone. What survives it: a scheduled run pins its commit, so a re-run replays an old one while production moves on; `db-backup-*` and `db-migrate-*` are separate concurrency groups, so a merge can apply a migration mid-dump; and a reverted migration or DDL applied by hand puts production ahead outright. The verify step below is the net under those.

The verify step now reads the dump's own `COPY` headers, compares them against the schema it just built, and treats *production ahead of the repo* as what it is: a stale verifier, not a bad backup. It names the drift, gives the data somewhere to land, restores and counts it, uploads — and still exits non-zero so the mismatch gets chased.

The harness below replays that exact day against two real PostgreSQL clusters: one migrated through `0026` standing in for production, one stopping at `0025` standing in for the repo the job checked out.

```bash
node docs/demos/backup-schema-drift/replay-backup-verify.mjs
```

```output
production has been migrated through 0026_inbox_dispatch.sql; the repo stops one short.
  production items.dispatched_at : yes
  verifier   items.dispatched_at : no

── before: the load the backup used to run ─────────────────────────────────
  psql exit code : 3
  psql says      : ERROR:  column "dispatched_at" of relation "items" does not exist
  → the job died here, so the dump was never uploaded. No backup that day.

── after: the verify step inspects the dump first ──────────────────────────
  ⚠ production is AHEAD of database/migrations — the dump carries shapes the repo cannot build:
      items: dispatched_at
    The dump is sound; the VERIFIER is stale. migrate.yml applies on merge, so check, in
    order: is this a re-run replaying an older pinned commit? did a merge land mid-dump
    (db-backup-* and db-migrate-* are separate concurrency groups)? was a migration
    reverted, or DDL applied by hand outside the workflow?

  reconciling the throwaway so the payload has somewhere to land:
    alter table public."items" add column "dispatched_at" text

  psql exit code : 0
  items: 2 rows restored
  folders: 1 rows restored
  projects: 1 rows restored
  …including 1 row whose dispatched_at came through the drifted column.
  → the dump is verified and uploaded; the run still exits non-zero (see below).

── the reverse case: a dump SHORT of the repo is normal, not drift ─────────
  (dumped between a merge and its migrate job, or from an instance whose job failed)
  drift reported : none — the backup stays green

── the run’s exit code: a saved backup does not excuse a stale repo ────────
  after this drifted run     : 1 (red — GitHub emails the owner)
  once the migration is in   : 0 (green)
```

Note the two directions are not symmetric. A dump taken between a merge and its migrate job, or against an instance whose migrate job failed (`migrate.yml` runs `fail-fast: false`, so one instance can lag the other), is simply *short* of the repo — `COPY` leaves the extra columns at their defaults — and must never fail a backup. Only production-ahead-of-repo can abort a load, and only that direction is reported.
