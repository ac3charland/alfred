# database — alfred schema & migrations

Supabase (PostgreSQL) schema for alfred. See `docs/specs/product/SPEC.md` §3 for the data model.

## Layout

- `migrations/` — ordered SQL migrations (`NNNN_name.sql`). Applied in filename order.
- `seed.sql` — tiny development dataset (folders + a nested subtask tree).
- `src/deploy.ts` — the applier the merge pipeline runs (see
  [Applying on merge](#applying-on-merge-the-default-path)); also usable locally.

## Schema summary

### `0001_initial_schema.sql`

- **`item_type`** enum: `unclassified | task | code | knowledge`
- **`item_status`** enum: `active | completed`
- **`folders`** — flat organizational buckets (`id`, `name`, `created_at`).
- **`items`** — the generic-item core (§3.2) plus task fields (§3.3):
  - base: `id`, `title`, `notes`, `source_url`, `item_type`, `created_at`, `raw_capture`
  - task: `due_date`, `status`, `completed_at`, `folder_id` (→ Inbox when null), `parent_id`
    (self-reference adjacency list for arbitrary-depth subtasks; `ON DELETE CASCADE`).
- **RLS** (§7): `authenticated` role has full access; `anon` is denied. The server-side
  secret/service_role key bypasses RLS for the Siri/external ingress.
- **Functions** (called via `supabase.rpc(...)`):
  - `get_subtree(root_id)` — depth-guarded recursive read of a task + all descendants.
  - `complete_subtree(root_id)` — cascade-complete a task and all descendants (§3.6).

### `0002_software_factory.sql` — the `code` module (code-module spec §4)

The Software Factory: Project / Epic / Story model + the refine→implement lifecycle.

- **`code_factory_state`** enum: `needs_refinement | in_refinement | ready_for_dev |
  in_development | ready_for_review | done | blocked | abandoned`.
- **`code_lane`** enum: `human | local` (only `human` used now; `local` reserved for Lane 1).
- **`projects`** — a project = a GitHub repo. Immutable 3-char `key` (`^[A-Z][A-Z0-9]{2}$`),
  `repo_owner`/`repo_name`, and `ref_seq` (the shared per-project ref counter for epics AND stories).
- **`epics`** — grouping buckets with optional `notes`, a `ref` (`KEY-N`), and `archived_at`.
- **`code_items`** — 1:1 sidecar on `items` (`item_type='code'`); presence = "in the factory".
  Carries `factory_state`, `lane`, `ref`, the spec snapshot (`spec_path`/`spec_sha`/`spec_markdown`),
  and PR URLs.
- **`items` task-gating**: existing `unclassified` rows are promoted to `task`, then a CHECK
  constraint (`items_task_only_fields`) makes non-`task` rows structurally incapable of a
  `due_date`, `parent_id`, or completed status — completion/due-dates/subtasks are task-only (§7.3).
- **Views** (both `security_invoker`): `task_items` (items NOT in the factory — the Tasks/Inbox
  read path) and `v_code_stories` (code stories joined to item + project + epic — the Code view).
- **RPCs** (`security invoker`, atomic ref allocation): `next_code_ref(project)`,
  `create_epic(project, name)`, `enter_code_module(item, project, epic)`.
- **RLS/grants**: same single-user pattern as `0001` (`authenticated` full access; explicit
  table/view/function GRANTs to `anon, authenticated, service_role`).

## Applying on merge (the default path)

**Merging a migration to `main` applies it — to both instances.** `.github/workflows/migrate.yml`
runs `database/src/deploy.ts` on every push to `main`, as a `personal` / `work` matrix
(`fail-fast: false`) over the same session-pooler secrets the nightly backup uses
(`SUPABASE_DB_URL_PERSONAL` / `SUPABASE_DB_URL_WORK`). Nothing pending → it reads the ledger, says
"already up to date", and exits. You don't apply migrations by hand as part of shipping any more;
the [instance-isolation rule](../docs/instance-isolation.md) that *every* migration must reach
*both* databases is now mechanical rather than remembered.

How it decides what to run:

- **`public.schema_migrations`** — a ledger table **in each database**, one row per applied
  migration filename, which is the only thing an unattended applier can act on: "what has *this*
  database seen?" The deployer creates the ledger itself (`create table if not exists`) — it is
  not a migration, because it has to exist before the first migration can be judged.
- **Pending = every migration file the ledger doesn't record**, applied in filename order. Each file
  runs in **one transaction together with its ledger row**, so a failure leaves neither half-applied
  SQL nor a row claiming success. A `pg_advisory_lock` around the run keeps concurrent runs (a
  re-queued workflow, say) from racing.
- **An empty database** (a newly provisioned instance) has no schema and no ledger, so it simply
  gets every migration from `0001` — provisioning a new instance needs no manual bootstrap step.
- **An _unadopted_ database — schema but no ledger — is refused, loudly.** Its history is
  unknowable from the outside, and a guess is unrecoverable: recording an assumed history marks the
  gaps it actually has as applied and hides them forever. Both live databases proved the point when
  this landed — Work was nine migrations behind (`0018`–`0026`) and Personal had lost `0016`'s
  function rewrite, so *neither* stood where an assumed baseline would have put it.
- **Adoption is one explicit command**, naming the migration you have verified the database stands
  at: `npm run deploy -w database -- --baseline 0017_grant_v_code_stories.sql`. Everything through
  that file is recorded as applied, the rest is applied normally, and the database is ordinary from
  then on. The workflow never passes `--baseline` — a merge must not adopt anything.

Two things worth knowing:

- **The migration lands after the app code.** Vercel deploys `main` on its own schedule and nothing
  orders the two, so write migrations **expand-then-contract**: the new schema must work with the
  code already live, and a column/table is only dropped in a later migration. This is the same
  discipline the pipeline's speed makes cheap, not a new constraint.
- **The ledger is in `public`** so it travels with the schema-scoped nightly dump (a restored
  database still knows its history) and it is deliberately **left ungranted**, so the PostgREST API
  roles can't see it. The integration suite asserts both. The next `supabase gen types` run will list
  `schema_migrations` in `frontend/lib/database.types.ts` — expected, and unused by app code.

Both live databases were adopted and caught up when this landed (Work: `0018`–`0026`; Personal:
`0016`), and each database's own `schema_migrations` ledger records those applies — so neither
needs adopting again.

Watch a run under **Actions → Migrate Databases**; a failure emails the repo owner like any other
red workflow. To see what a live database is missing without writing anything:

```bash
# Reads DATABASE_URL from frontend/.env.local (or an exported SUPABASE_DB_URL / DATABASE_URL):
npm run deploy -w database -- --dry-run
```

## Pre-merge iteration and generating types

There is no sanctioned way to hand-apply a migration to the hosted Personal or Work project
any more — not even to iterate before a PR lands. That practice is exactly what let ALF-119/124
drift silently, since a manual apply only reaches the repo if someone remembers to write it down.
Validate a new migration against real Postgres with the integration suite instead (see
[Testing the migrations against real Postgres](#testing-the-migrations-against-real-postgres)
below), which applies every migration to a throwaway cluster on every run; preview what a live
database is missing, without writing anything, with `npm run deploy -w database -- --dry-run`
(see above).

Regenerating `frontend/lib/database.types.ts` still needs a live schema to introspect — point it at
an already-migrated hosted project. Env values live in `frontend/.env.local` (gitignored). Prefer
the **Direct connection** URI (it's IPv6 and works from a normal machine); if your network is
IPv4-only, use the **Session pooler** string (port 5432) instead.

```bash
# Regenerate the TypeScript types after a schema change (Docker must be running; pin a
# mid-2.9x CLI — the latest CLI requires an access token for --db-url, see the supabase skill):
npx --yes supabase@2.95.0 gen types typescript --db-url "$DATABASE_URL" > frontend/lib/database.types.ts
```

Token-free `--db-url` introspection needs a local Docker `postgres-meta` container, so start
Docker first. The current CLI dropped the token-free path; pin `supabase@2.95.0`. See the
`supabase` skill ("Regenerating `database.types.ts`") for the version details.

## Testing the migrations against real Postgres

The app's unit/Storybook/E2E suites run against a **JavaScript Supabase mock**, which
reimplements the RPCs in JS — so it can't reproduce anything that lives in real-Postgres
semantics: GRANTs, RLS, constraint-checking timing, sequences, triggers. Two shipped 500s
proved the gap (`0008` a missing sequence grant; `0007` a non-deferrable-unique 409). This
package closes it with two checks:

- **`npm run check:slow -w database`** (also via the root `check:slow` fan-out → pre-push +
  CI) — the **integration suite** (`src/run.ts`). It stands up a throwaway PostgreSQL
  cluster, seeds the Supabase-provided objects (the three API roles + the `supabase_realtime`
  publication), applies **every** migration in filename order exactly as production does, then
  asserts each RPC as the real `authenticated`/`anon` roles (`SET ROLE`). Each known bug is a
  one-line regression here — red without its fix migration, green with it. Needs the
  PostgreSQL **server** binaries (`initdb`/`pg_ctl`); install the `postgresql` package if
  they're missing. Runs the server as the `postgres` user when invoked as root.
  It also runs the **deployer's** assertions (`src/deploy-assertions.ts`) on their own throwaway
  databases on that cluster: a fresh database takes every migration and a second run applies
  nothing, an unadopted database is refused rather than guessed at, an explicit `--baseline` adopts
  one and applies the rest, a file and its ledger row land together or not at all, and the ledger
  stays unreadable to `anon`/`authenticated`.
- **`npm run lint:migrations -w tools/migration-lint`** (via the root `check:fast`) — a
  static linter; its `sequence-grant` rule fails the build if a `create sequence` lacks a
  `grant usage … to anon, authenticated, service_role`. Cheap, no container; catches the
  grant class at commit time. See the `migration-lint` skill.

## Daily backups

The Supabase **free tier** has **no automated backups**, and the migrations only rebuild the
*schema* — the **data** is unrecoverable if lost. A scheduled GitHub Actions workflow
(`.github/workflows/backup.yml`) closes that gap: nightly it takes a full logical dump, proves the
dump restores, and uploads it to a Cloudflare **R2** bucket. All the real logic lives in the
testable `src/backup.ts` (the YAML is not linted or type-checked, so it stays thin); its pure
helpers are unit-tested in `src/backup.test.ts`.

alfred runs as **two physically-isolated instances** (Personal and Work), each its **own Supabase
database** (see [`docs/instance-isolation.md`](../docs/instance-isolation.md)). The workflow is a
**matrix** over those instances (`fail-fast: false`), so each database is dumped in its own job and
one instance's failure never suppresses the other's. Every R2 key carries the instance it came from
(`daily/<instance>/…`, `monthly/<instance>/…`), so both instances share **one** bucket without
colliding.

What each instance's nightly job does, in this fixed order (a dump that fails to restore never
uploads or counts as green — a red run triggers GitHub's failed-scheduled-run email to the repo
owner):

1. **Dump** — `supabase db dump` writes schema only by default, so the script takes a schema dump
   plus a `--data-only` dump (both scoped to the **`public`** schema — that's all the app's data;
   `auth`/`storage` are Supabase-managed) and assembles one gzip: the schema, then the data loaded
   with `session_replication_role = replica`. That guard matters — `items.parent_id` is a
   self-referential (circular) FK, so a plain data-only load fails on row ordering; disabling
   FK/trigger checks during the COPY (the source data is already consistent) is what lets the artifact
   restore standalone. A size floor rejects an empty/truncated dump.
2. **Verify** — rebuilds the schema in a throwaway Postgres (an Actions service container) from the
   committed migrations — which restore cleanly on vanilla Postgres, unlike the dump's own DDL, which
   references the hosted Supabase `extensions` schema — then loads the dump's **data** into it with the
   same FK guard and asserts the core tables (`items`, `folders`, `projects`) are present. The data is
   the irreplaceable asset (the schema lives in git), so proving it reloads into the canonical schema
   is the check that matters.
3. **Upload** — copies the SAME verified gzip to two keys: `daily/<instance>/YYYY-MM-DD.sql.gz` (one
   slot per UTC day; a same-day re-run overwrites) and `monthly/<instance>/YYYY-MM.sql.gz` (one slot
   per month; each daily run overwrites it, so it settles to the month's last good backup and freezes
   when the month rolls over).

Run one instance locally / as a restore drill with `INSTANCE=personal npm run backup -w database`
(needs the same env vars).

### One-time setup (do this once; the workflow is inert until it's done)

1. **Create one R2 bucket** (shared by both instances — the instance segment sits *under* the tier
   prefix, so a single lifecycle rule covers both). Add **one object-lifecycle rule**: expire objects
   under the **`daily/`** prefix after **~35 days** (holds ~30 rolling dailies per instance). Add
   **no rule** for `monthly/`, so monthly snapshots are kept indefinitely.
2. **Create an R2 API token** (S3 credentials) scoped to that bucket → gives an access key id, a
   secret access key, and the S3 endpoint URL (`https://<account-id>.r2.cloudflarestorage.com`).
3. **Add these GitHub Actions secrets** (repo → Settings → Secrets and variables → Actions — never
   commit or echo them). The Supabase URL is **per instance**; the R2 credentials are shared:

   | Secret | Value |
   | --- | --- |
   | `SUPABASE_DB_URL_PERSONAL` | **Personal** instance's Supabase **Session pooler** URI (IPv4, port **5432**) — see the callout below |
   | `SUPABASE_DB_URL_WORK` | **Work** instance's Supabase **Session pooler** URI (same rules) |
   | `R2_ACCESS_KEY_ID` | R2 token's access key id |
   | `R2_SECRET_ACCESS_KEY` | R2 token's secret access key |
   | `R2_BUCKET` | the bucket name |
   | `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |

4. **Trigger the workflow once** (Actions → Backup → *Run workflow*) to prove the path end-to-end;
   both the `personal` and `work` matrix jobs should go green.

> **The Supabase URL — the non-obvious one.** Each `SUPABASE_DB_URL_*` MUST be that instance's
> **Session pooler** connection (IPv4, port **5432**). NOT the Direct connection (IPv6-only on the
> free tier → the IPv4-only Actions runner can't reach it) and NOT the Transaction pooler (port 6543
> → doesn't support `pg_dump`). Session mode is the one that is both reachable and
> `pg_dump`-compatible. Take care to pair each instance's pooler URL with the matching secret —
> swapping them would back the Work database up under `personal/` and vice versa.

### Restoring from a backup

Pick the instance you're restoring, then download the object you want from R2 — a recent day from
`daily/<instance>/`, or an older month from `monthly/<instance>/` — and load it into the target
database. Because the dump is **full** (schema + data), this reconstructs everything with no
migration replay:

```bash
# List what's available for one instance, then pull one object (uses the R2 S3 credentials + endpoint):
aws s3 ls "s3://$R2_BUCKET/daily/personal/" --endpoint-url "$R2_ENDPOINT"
aws s3 cp "s3://$R2_BUCKET/daily/personal/2026-07-17.sql.gz" ./restore.sql.gz --endpoint-url "$R2_ENDPOINT"

# Restore into the target database (that instance's fresh Supabase project, or a local cluster):
gunzip -c ./restore.sql.gz | psql "<target-db-url>"
```

The nightly verify step exercises exactly this restore path every day, so the procedure is
continuously proven, not aspirational.
