---
branch: claude/daily-database-backups-9kmhvs
---

# Daily database backups to Cloudflare R2 (per instance)

*2026-07-18T00:19:31.177Z*

A scheduled GitHub Actions workflow (`.github/workflows/backup.yml`) takes a nightly full logical dump of **each isolated Alfred instance** (Personal and Work — separate Supabase databases), proves each dump restores into a throwaway Postgres, and uploads the verified gzip to one Cloudflare R2 bucket. Keys are partitioned by instance (`daily/<instance>/…`, `monthly/<instance>/…`) so both share a bucket without colliding, and a matrix runs the two instances as independent jobs. All real logic lives in the testable `database/src/backup.ts`; the YAML stays thin because workflows are outside the lint/type-check gates.

**The behavioral core (headless — no UI surface).** `backup.ts` decides each instance's R2 object keys, guards against an empty/truncated dump, and asserts a restored dump is structurally sound. Calling the real shipped functions:

```bash
node --input-type=module -e '
import { backupKeys, assertDumpSize, assertCoreTables } from "./database/src/backup.ts";
const when = new Date("2026-07-17T08:17:00.000Z");
for (const instance of ["personal", "work"]) {
  console.log(`${instance} keys:`, JSON.stringify(backupKeys(instance, when)));
}
try { assertDumpSize(40); } catch (e) { console.log("rejects tiny dump:", e.message); }
try { assertCoreTables(["items","folders"]); } catch (e) { console.log("rejects incomplete restore:", e.message); }
assertDumpSize(50000); assertCoreTables(["items","folders","projects"]);
console.log("accepts a real dump with all core tables: ok");
' 2>/dev/null
```

```output
personal keys: {"daily":"daily/personal/2026-07-17.sql.gz","monthly":"monthly/personal/2026-07.sql.gz"}
work keys: {"daily":"daily/work/2026-07-17.sql.gz","monthly":"monthly/work/2026-07.sql.gz"}
rejects tiny dump: dump is implausibly small (40 bytes < 512 floor) — likely empty or truncated; refusing to verify or upload
rejects incomplete restore: restored dump is missing core tables: projects — dump is not structurally sound; refusing to upload
accepts a real dump with all core tables: ok
```

**The orchestrator fails hard on missing config** — it never silently "succeeds" without doing a backup. Run the shipped entrypoint with nothing in the environment; it stops at the first required variable (the instance to back up):

```bash
node database/src/backup.ts 2>&1 | grep "^backup: "
```

```output
backup: missing required env var INSTANCE
```

**Manual acceptance (end-to-end, run once after the secrets are set).** The live dump → verify → upload can only run against real Supabase/R2 credentials, which exist only in GitHub Actions secrets — never in this repo. After the one-time setup in `database/README.md` (one R2 bucket + a `daily/` lifecycle rule, the R2 token, and a **per-instance** `SUPABASE_DB_URL_PERSONAL` / `SUPABASE_DB_URL_WORK` plus the shared R2 secrets), trigger **Actions → Backup → Run workflow** and confirm both matrix jobs (`backup (personal)` and `backup (work)`) go green with `dump ok` → `verify ok` → `uploaded daily/<instance>/…`. Then confirm the objects exist per instance with `aws s3 ls "s3://$R2_BUCKET/daily/personal/" --endpoint-url "$R2_ENDPOINT"` (and `daily/work/`). The nightly verify step exercises this exact restore path every day, so the documented restore procedure stays continuously proven.
