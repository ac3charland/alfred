---
branch: claude/daily-database-backups-9kmhvs
---

# Daily database backups to Cloudflare R2

*2026-07-17T19:30:43.072Z*

A scheduled GitHub Actions workflow (`.github/workflows/backup.yml`) takes a nightly full logical dump of the Supabase database, proves the dump restores into a throwaway Postgres, and uploads the verified gzip to a Cloudflare R2 bucket under two keys (a rolling `daily/` slot and a `monthly/` snapshot). All real logic lives in the testable `database/src/backup.ts`; the YAML stays thin because workflows are outside the lint/type-check gates.

**The behavioral core (headless — no UI surface).** `backup.ts` decides the R2 object keys for a run, guards against an empty/truncated dump, and asserts a restored dump is structurally sound. Calling the real shipped functions:

```bash
node --input-type=module -e '
import { backupKeys, assertDumpSize, assertCoreTables } from "./database/src/backup.ts";
const when = new Date("2026-07-17T08:17:00.000Z");
console.log("object keys for a 2026-07-17 run:", JSON.stringify(backupKeys(when)));
try { assertDumpSize(40); } catch (e) { console.log("rejects tiny dump:", e.message); }
try { assertCoreTables(["items","folders"]); } catch (e) { console.log("rejects incomplete restore:", e.message); }
assertDumpSize(50000); assertCoreTables(["items","folders","projects"]);
console.log("accepts a real dump with all core tables: ok");
' 2>/dev/null
```

```output
object keys for a 2026-07-17 run: {"daily":"daily/2026-07-17.sql.gz","monthly":"monthly/2026-07.sql.gz"}
rejects tiny dump: dump is implausibly small (40 bytes < 512 floor) — likely empty or truncated; refusing to verify or upload
rejects incomplete restore: restored dump is missing core tables: projects — dump is not structurally sound; refusing to upload
accepts a real dump with all core tables: ok
```

**The orchestrator fails hard on a missing secret** — it never silently "succeeds" without doing a backup. Run the shipped entrypoint with no credentials in the environment:

```bash
node database/src/backup.ts 2>&1 | grep "^backup: "
```

```output
backup: missing required env var SUPABASE_DB_URL
```

**Manual acceptance (end-to-end, run once after the secrets are set).** The live dump → verify → upload can only run against real Supabase/R2 credentials, which exist only in GitHub Actions secrets — never in this repo. After completing the one-time setup in `database/README.md` (create the R2 bucket + two lifecycle rules, mint the R2 token, add the five secrets), trigger the workflow: **Actions → Backup → Run workflow**. Confirm the run is green with the job log showing `dump ok` → `verify ok — core tables present` → `uploaded daily/…` and `uploaded monthly/…`, then confirm the dated object exists in R2:

Check R2 with `aws s3 ls "s3://$R2_BUCKET/daily/" --endpoint-url "$R2_ENDPOINT"` (and the same for `monthly/`). The nightly verify step exercises this exact restore path every day, so the documented restore procedure in `database/README.md` is continuously proven.
