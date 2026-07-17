# Spike: scheduled cloud backups of the Supabase database

**Decision.** A **scheduled GitHub Actions workflow** takes a daily logical dump of the Supabase
Postgres database with `supabase db dump` (pg_dump under the hood), gzips it, and uploads it to a
**Cloudflare R2** bucket with a lifecycle rule for retention. This keeps us on the Supabase **free
tier** (which has no automated backups) at effectively **$0**. This document is the technical
justification and shape for a future implementation spec — not the spec itself.

## Where we landed

- **What runs:** `.github/workflows/backup.yml`, a scheduled workflow (`on: schedule: cron`) —
  sibling to the existing [`ci.yml`](../.github/workflows/ci.yml).
- **How the dump is produced:** the `supabase` CLI (`supabase db dump`), a hardened wrapper over
  `pg_dump`, run natively on the Ubuntu runner; output gzipped.
- **Where it goes:** a Cloudflare **R2** bucket, via `aws s3 cp` against R2's S3-compatible
  endpoint. Retention (e.g. keep 30 dailies) via an **R2 object-lifecycle rule**, not scripting.
- **Cost:** effectively $0 — see the cost section.

## Why each choice

### Why R2 for storage

- **S3-compatible**, so standard `aws s3` / `rclone` tooling works unchanged.
- **10 GB free storage tier** — a personal Postgres dump is single-digit MB, so we sit far inside
  it indefinitely.
- **Zero egress fees** — restores (and restore *drills*) are free, unlike S3/Glacier retrieval.
- **Already in our stack** — we run Cloudflare Workers; no new provider.

### Why GitHub Actions runs the job (not a Cloudflare Cron Worker)

The decisive reason is not scheduling preference — it's that **a Cloudflare Worker cannot execute
`pg_dump` at all.** A Worker is a V8 isolate: no shell, no filesystem, no `child_process` to spawn
a native binary. `pg_dump` is a compiled executable with nowhere to run there. Choosing a Cron
Worker would therefore mean **reimplementing pg_dump in JavaScript** (open a Postgres socket, read
`pg_catalog`, `COPY` each table, hand-serialize DDL/sequences/RLS/ordering) — fragile, bespoke
code owning our disaster-recovery artifact. A GitHub Actions runner is a full Ubuntu VM where the
battle-tested tool runs as-is. Additional fit:

- **Free at our volume** (see cost).
- **Secrets + tooling built in** — Actions secrets hold the DB and R2 credentials; the runner has
  the Postgres client / can install the Supabase CLI.
- **Lives beside what it protects** — the workflow sits next to
  [`database/migrations/`](../database/migrations/), our schema source of truth, and a restore can
  be exercised in CI.

## Technical shape (for the implementation spec to expand)

```yaml
# .github/workflows/backup.yml  (skeleton — the spec fleshes this out)
on:
  schedule:
    - cron: '17 9 * * *'   # daily; minute offset to avoid top-of-hour scheduler contention
  workflow_dispatch: {}     # allow manual runs / restore drills
jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - name: Dump + gzip
        run: supabase db dump --db-url "$SUPABASE_DB_URL" -f - | gzip > backup.sql.gz
        env: { SUPABASE_DB_URL: '${{ secrets.SUPABASE_DB_URL }}' }
      - name: Upload to R2
        run: aws s3 cp backup.sql.gz "s3://$R2_BUCKET/$(date -u +%Y-%m-%d).sql.gz" --endpoint-url "$R2_ENDPOINT"
        env: { AWS_ACCESS_KEY_ID: '${{ secrets.R2_ACCESS_KEY_ID }}', AWS_SECRET_ACCESS_KEY: '${{ secrets.R2_SECRET_ACCESS_KEY }}', R2_BUCKET: '${{ secrets.R2_BUCKET }}', R2_ENDPOINT: '${{ secrets.R2_ENDPOINT }}' }
```

- **Secrets** (GitHub → Settings → Secrets and variables → Actions; never inlined): the Supabase
  connection string, and R2 access key / secret / endpoint / bucket.
- **Full dump vs data-only.** Our **DDL already lives in git** (`database/migrations/`), so the
  backup's unique value is the **data**. Recommend a **full logical dump** anyway so each artifact
  is self-contained and restorable without replaying migrations — but the spec should decide, and
  note that migrations remain the authoritative schema.

> **Gotcha to capture now — connection string, not the obvious one.** Use the Supabase
> **session-mode pooler** connection (IPv4, port 5432), **not** the direct connection and **not**
> the transaction pooler. GitHub Actions runners are IPv4-only, while Supabase's *direct*
> connection is IPv6-only on the free tier (it would simply fail to connect); and the
> *transaction-mode* pooler (port 6543) doesn't support `pg_dump`. Session mode is the one that is
> both reachable and pg_dump-compatible. This is the kind of non-obvious failure a spike exists to
> surface before the spec hits it.

## Sidebars: appealing alternatives we're not taking

> **Why not S3 Glacier?** Glacier optimizes **storage cost**, which is already ~$0 for a
> single-digit-MB dump — even plain S3 Standard would be a fraction of a cent/month. In exchange
> Glacier *adds* real pain to a backup you might need urgently: hours-long retrieval, retrieval
> fees, and 90/180-day minimum-storage-duration charges. It optimizes the wrong axis and worsens
> the one that matters (fast, free restore). R2's zero-egress model is the opposite trade.

> **Why not run the cron in a Cloudflare Worker?** Covered above: Workers can't execute the
> `pg_dump` binary, so "cron in Cloudflare" would mean hand-rolling dump logic in JS for our DR
> artifact. Cloudflare Cron Workers remain the right home for **pure-JS/HTTP** scheduled jobs
> (e.g. notification pushes) — just not for running a native database tool.

> **Why not AWS (SNS/S3) via CDK?** Separate, fuller discussion, but in short: standing up a new
> cloud provider plus a heavyweight IaC layer (CDK bootstrap + CloudFormation) to provision one
> bucket is front-loaded cost with no marginal payoff at this scale. R2 + Actions uses only
> providers already in the stack, with no IaC substrate to carry.

## Operational notes for the spec

- **Outside the back-pressure gates.** A workflow in `.github/` is **not** covered by
  `check:fast` / `check:slow` — no hook lints or type-checks it. Keep the YAML thin; if logic
  grows, push it into a small committed script under `database/` that a test *can* cover, rather
  than accreting untested bash. A broken backup fails silently (a red scheduled run, or worse a
  skipped one) — so treat verification as a first-class concern.
- **GitHub scheduled-cron caveats.** Scheduled runs can be **delayed** under GitHub load (fine for
  a daily backup, bad for to-the-minute timing), and a repo with **60 days of no activity
  auto-disables** its scheduled workflows (a non-issue for an active repo).
- **Restore drills.** A backup unverified against a restore is a hope, not a backup. The spec
  should define a periodic restore drill (feasible in CI precisely because R2 egress is free) that
  loads a dump into a throwaway Postgres — the `database/` slow suite already spins one up.
- **Failure alerting.** A silently-failing nightly is the main risk. The obvious sink for a
  "backup failed" alert is the Telegram channel from
  [`notifications-spike.md`](./notifications-spike.md). The two features remain **independent** —
  this is a later, optional wiring, noted so the spec keeps the seam in mind.

## Cost & open questions for the spec

- **Cost:** effectively $0. A daily ~1-minute job is ~30 min/month against GitHub Free's
  2,000 private-repo minutes; the stored dumps sit inside R2's 10 GB free tier.
- **Open questions:** retention count and cadence (dailies kept for N days? weekly rollups?);
  encryption (R2 server-side vs client-side `gpg` before upload for defense-in-depth); whether to
  also snapshot Supabase **Storage** buckets (currently none in use); restore-drill frequency; and
  alerting-on-failure wiring.

## Sources

- [Supabase CLI — `db dump`](https://supabase.com/docs/reference/cli/supabase-db-dump)
- [Cloudflare R2 — S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 — object lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
- [GitHub Actions — scheduled events (`schedule`)](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule)
