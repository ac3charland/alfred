# database — alfred schema & migrations

Supabase (PostgreSQL) schema for alfred. See `docs/specs/product/SPEC.md` §3 for the data model.

## Layout

- `migrations/` — ordered SQL migrations (`NNNN_name.sql`). Applied in filename order. Numbers are
  unique bar two applied legacy pairs (`migration-lint`'s `unique-number` rule and the
  `Migration numbers` CI check fail a new duplicate): take the next one from a freshly fetched
  `origin/main`.
- `seed.sql` — tiny development dataset (folders + a nested subtask tree).
- `src/deploy.ts` — the applier the merge pipeline runs (see
  [Applying on merge](#applying-on-merge-the-default-path)); also usable locally.
- `src/gen-types.ts` — regenerates the frontend's `Database` type from the migrations, with no live
  database (see [Regenerating the types](#regenerating-frontendlibdatabasetypests)).

## Schema summary

### `0001_initial_schema.sql`

- **`item_type`** enum: `unclassified | task | code | knowledge` (`research` added by `0042`)
- **`item_status`** enum: `active | completed`
- **`folders`** — flat organizational buckets (`id`, `name`, `created_at`, and an optional
  `description` saying what belongs there — see `0028`).
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
  `repo_owner`/`repo_name`, `ref_seq` (the shared per-project ref counter for epics AND stories),
  and an optional `description` of what the project is and what work belongs in it (`0028`).
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

### `0030_weekly_plan_items.sql` — the weekly-review loop (ALF-195)

Two keyed endpoints let the weekly review write a week's plan into alfred as real items, then
read back what became of them. Everything they stand on lives here:

- **`items.weekly_plan_id`** — nullable FK to `weekly_plans (id)`, `on delete set null` (the
  items are real work and outlive the archived document), with a partial index over the non-null
  set. Deliberately **not** in `items_task_only_fields`: it is provenance, and it must survive
  `enter_code_module` flipping a planned item to `code`.
- **`task_items` re-created** so the new column reaches the read path (the `select i.*` freeze
  `0011`/`0013`/`0018`/`0026`/`0029` each document).
- **`create_weekly_plan_items(plan, items)`** — `security invoker`, granted to all three API
  roles. Writes a whole batch of roots plus their children in **one transaction**, stamping the
  cohort key on every row and leaving them all in the Inbox. Root `created_at` descends with
  array position, so the Inbox lists the week in the order it was sent.
- **`code_items.done_at`** plus a `before update of factory_state` trigger that stamps it on
  entering `done` and clears it on leaving — in the database, not the route, because the Worker
  patches `code_items` straight through PostgREST when a PR merges. Stories that reached `done`
  before this migration have `null`; the factory kept no transition history to backfill from.

### `0035_reader.sql` — the Reader module (ALF-233)

A newsletter post is never an item: it arrives, is (maybe) summarised, is (maybe) read, and is
archived — it has no due date, no folder, no subtask tree. So it gets its own tables, same
reasoning `0034` already applies to a comms message.

- **`reader_publications`** — the roster a post's sender is matched against. `source` is `auto`
  (added by the Substack discovery view) or `owner` (added by hand); `enabled = false` pauses a
  publication without losing its mail from the Comms mirror.
- **`reader_posts`** — one row per extracted post, unique on `(account_key, gmail_message_id)`
  (the dedupe key a concurrent tick's insert wins or loses on — never a cursor). `summary_state`
  is `pending | done | refused | failed`, and `reader_posts_done_has_summary` rejects a `done` row
  with no gist. `summarizing_since` is the tick's lease against overlapping runs; `model_called_at`
  is what the daily-cap read counts.
- **`reader_health`** — a singleton, seeded by this migration so the tick only ever patches it.
- **`comm_messages.reader_claimed_at`** — the one column Reader adds to Comms' table: stamped on
  a message once it either produced a post or turned out unusable, so the worklist view never
  re-offers it.
- **`v_reader_worklist`** — inbound gmail-personal mail from an enabled publication, unclaimed,
  with no post yet, from the last seven days — the tick's whole read.
- **`v_reader_discovery`** — Substack senders with a list header, not already on the roster, from
  the last seven days, excluding Substack's own `no-reply@`/`noreply@` platform senders.

There is no publications route yet, so the roster is seeded by hand. Add a non-Substack
publication:

```sql
insert into reader_publications (handle, name, source) values ('news@example.com', 'Example', 'owner');
```

Pause one:

```sql
update reader_publications set enabled = false where handle = 'news@example.com';
```

### `0036_reader_operability.sql` — running the Reader without SQL (ALF-234)

`0035` built the pipe; this makes it legible and bounded from the app.

- **`reader_health.daily_cap` / `calls_today` / `calls_day`** — the ceiling the tick enforced and
  the model calls it had made for that UTC day, stamped at the start of each run (the count as it
  stood then) and again at the end. The UI reads "the ceiling is reached" off these rather than
  knowing the Worker's deploy vars.
- **`reader_posts.text_swept_at`** — when the retention sweep took the body. Null = the post
  still holds its text, or never had any; a swept post can never be re-summarised.
- **`v_reader_candidates`** — inbound bulk senders on the personal account inside 30 days that
  are NOT on the roster, ranked by volume then recency, carrying the most recent display name.
  Wider than `v_reader_discovery` (any domain, 30 days) because a human decides what to do with
  each row rather than it being auto-added.
- **`v_reader_publications`** — every roster row plus `last_post_at`, the newest `received_at`
  across its posts (null for a publication with none). Derived rather than denormalised: a
  per-post write back to the roster would cost the tick a subrequest it doesn't have.
- **`reader_sweep_text(p_days, p_limit)`** — nulls the body of one batch of posts past the
  window and returns how many. The Worker loops until it returns 0, so each batch is its own
  transaction and a timed-out catch-up run keeps every batch it finished. A post with no body
  (null or empty `text`) is skipped, so it is never stamped `text_swept_at` — "swept" and "never
  had one" stay different answers. `security invoker`, so it runs as whoever calls it: both
  arguments floor at 1 and raise below it, so an obviously-wrong `p_days => 0` (which would null
  every body in the table) is loud rather than silent — that floor is not what stops an
  authenticated session from sweeping everything older than a day, since a legal `p_days => 1`
  call still can. The actual guard is that `anon` has no RLS policy on `reader_posts` and
  `authenticated` is the owner's own session, not an arbitrary caller.

### `0039_reader_instapaper.sql` — sending a post to Instapaper (ALF-238)

- **`reader_posts.html`** — the email's decoded `text/html` part, raw, kept at intake so a send can
  carry the post's own body (a paid post arrives whole, not as the paywall's teaser). Written only
  when that HTML produced `text` and fits the Worker's 1 M-character ceiling; the app never renders
  it and the list payload never carries it. Null for posts ingested before this migration.
- **`reader_posts.instapaper_sent_at`** — the last confirmed save to Instapaper; drives the row's
  "in Instapaper" badge and survives an unarchive.
- **`reader_posts.instapaper_bookmark_id`** — Instapaper's `bookmark_id` from that save, kept for a
  later Instapaper → wiki sync to match on.
- **`reader_sweep_text`** — unchanged signature and predicate; the retention sweep now nulls
  `html` in the same statement that nulls `text`.

### `0040_reader_wiki_evidence.sql` — sending Evidence to the wiki (ALF-271)

- **`reader_posts.wiki_sent_evidence`** — the exact text of every `overview.evidence` bullet
  already sent to the wiki, beside 0038's `wiki_sent_ideas` for Novel ideas. Its own column, so an
  idea and an evidence bullet with the same text never mark each other sent; a reworded bullet
  reads as unsent.
- **`append_wiki_sent_picks(p_post, p_ideas, p_evidence)`** — one atomic UPDATE appending to both
  columns, each with `append_wiki_sent_ideas`'s rules (only strings not already present, duplicates
  collapsed, first-occurrence order). `append_wiki_sent_ideas` stays until a later contract-step
  migration drops it.

### `0041_reader_instapaper_source.sql` — Instapaper articles as Reader posts (ALF-272)

An article the owner moves into the Instapaper folder "To Reader" becomes a Reader post, taken in
and summarised by the Worker's Reader tick.

- **`reader_posts.source`** — `gmail` (a newsletter) or `instapaper` (an article), defaulting to
  `gmail`, so every earlier row reads as the newsletter it is.
- **`reader_posts.site`** — an article's normalised host (lower-cased, `www.` dropped, a Substack
  app link as `<name>.substack.com`), written once at intake. The eyebrow and the model's
  `Publication:` line fall back to it; a later story links articles to publications by it.
- **`publication_id`, `account_key`, `gmail_message_id` lose `not null`**, and
  **`reader_posts_source_identity`** states what each source needs instead: a newsletter its whole
  mail identity, an article its `instapaper_bookmark_id` and none of the mail identity. An
  article's `publication_id` is left free for that later story.
- **`reader_posts_instapaper_source_key`** — unique on `instapaper_bookmark_id` among articles, so
  the insert is the claim; partial, so a newsletter holding the id of the bookmark its Send created
  never collides. **`reader_posts_instapaper_bookmark_idx`** backs the tick's "already a post?"
  read across both sources.
- **`reader_health.instapaper_last_success_at` / `_last_error` / `_last_error_at`** — the To Reader
  leg's own health, apart from the summariser's, read by the Reader header's Instapaper dot.

### `0042_research_item_type.sql` — the `research` item type (ALF-298)

- **`item_type`** gains `research`: an open question the owner wants researched on the web and
  written up. Alone in its file because Postgres refuses to use an enum value inside the
  transaction that added it; everything that names it is in `0043`.

### `0043_research.sql` — research items become Reader posts (ALF-298)

Dispatching a research row consumes it into a Reader post that waits for its report; a Claude Code
Routine researches the question and delivers the report to the app, and from then on the post is
summarised and read like any other.

- **`items_dispatched_needs_folder`** — a `research` row, like `code` and `knowledge`, leaves the
  Inbox without a folder.
- **`reader_posts.source`** gains `research`, and **`reader_posts_source_identity`** a third branch:
  a research post carries none of the mail identity and no publication.
- **`reader_posts.research_*`** — the post's lifecycle beside the summary's own: `research_brief`
  (the question as fired: title, blank line, notes), `research_state` (`queued | researching |
  done | failed`, null off-source), `research_attempts`, `research_fired_at`,
  `research_session_url`, `research_error`, `research_delivered_at`. CHECKs: the state's values;
  a research post always has a brief and a state and nothing else does; a done post has its
  delivery stamp (not its text — the ninety-day sweep takes that like any post's); attempts not
  negative.
- **`send_items_to_research(p_ids)`** — all-or-nothing, `send_items_to_wiki`'s guards: stamps
  `dispatched_at` (logging any classifier correction), inserts one queued post per item, deletes
  the items, and returns the new posts.
- **`reader_sweep_text`** is unchanged: a report's body sweeps at ninety days; its brief, summary
  and session link stay.

## Applying on merge (the default path)

**Merging a migration to `main` applies it.** `.github/workflows/migrate.yml` runs
`database/src/deploy.ts` on every push to `main`, over the same session-pooler secret the nightly
backup uses (`SUPABASE_DB_URL_PERSONAL`). Nothing pending → it reads the ledger, says "already up to
date", and exits. You don't apply migrations by hand as part of shipping any more.

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
  gaps it actually has as applied and hides them forever. Both databases that were live when this landed
  proved the point — the since-retired Work instance was nine migrations behind (`0018`–`0026`) and Personal
  had lost `0016`'s function rewrite, so *neither* stood where an assumed baseline would have put it.
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

The live database was adopted and caught up when this landed (`0016`), and its own
`schema_migrations` ledger records those applies — so it needs no adopting again.

Watch a run under **Actions → Migrate Databases**; a failure emails the repo owner like any other
red workflow. To see what a live database is missing without writing anything:

```bash
# Reads DATABASE_URL from frontend/.env.local (or an exported SUPABASE_DB_URL / DATABASE_URL):
npm run deploy -w database -- --dry-run
```

To query a live database ad hoc, run `psql` through the wrapper. It reads `DATABASE_URL` the
same way and hands `psql` the password as `PGPASSWORD`, so the command never carries it and is
safe to record in a demo doc:

```bash
npm run psql -w database -- -c "select count(*) from items"
```

## Pre-merge iteration and generating types

There is no sanctioned way to hand-apply a migration to the hosted project
any more — not even to iterate before a PR lands. That practice is exactly what let ALF-119/124
drift silently, since a manual apply only reaches the repo if someone remembers to write it down.
Validate a new migration against real Postgres with the integration suite instead (see
[Testing the migrations against real Postgres](#testing-the-migrations-against-real-postgres)
below), which applies every migration to a throwaway cluster on every run; preview what a live
database is missing, without writing anything, with `npm run deploy -w database -- --dry-run`
(see above).

### Regenerating `frontend/lib/database.types.ts`

The frontend's `Database` type comes from the **migrations**, not from a live database, so it can be
regenerated on the branch that adds the migration — before anything merges:

```bash
npm run gen-types -w database              # rewrite frontend/lib/database.types.ts
npm run gen-types -w database -- --check   # exit 1 if the committed file is stale (writes nothing)
```

**Forgetting is a red push, not a surprise later.** The integration suite (`check:slow`, so the
pre-push hook and CI) asserts the committed types match the migrations — but **only on a branch that
adds or edits one**, since no other change can make them stale. It reuses the schema that suite has
already migrated, so the gate costs a string compare rather than another cluster.

`src/gen-types.ts` applies every committed migration to the same throwaway cluster the integration
suite uses, then describes the result with **postgres-meta's TypeScript template** — the generator
the Supabase CLI runs inside its container, pinned to the matching version. So it needs no
credentials, no Docker, and no hosted project, and the schema it reads is the one *your branch*
builds. Commit its output verbatim; the file is generated, so it's excluded from ESLint and Prettier
and must never be hand-edited.

Two things a local cluster cannot speak for, both deliberate:

- **Supabase's managed schemas are absent.** `graphql_public` (the `pg_graphql` extension), `auth`
  and `storage` exist only on a hosted project, so they aren't in the generated type. App code only
  ever reaches through `Database['public']`, so nothing depends on them.
- **`__InternalSupabase.PostgrestVersion`** describes the hosted platform's PostgREST, which a local
  cluster has no notion of. It's carried as a constant in `src/gen-types.ts` — bump it by hand if
  Supabase upgrades PostgREST.

The generated formatting comes from whichever **Prettier the workspace hoists** (postgres-meta calls
it internally and resolves the root copy), so a Prettier major bump will reflow this file — reflow it
by re-running the generator, never by hand.

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

Every R2 key carries an instance segment (`daily/personal/…`, `monthly/personal/…`). It dates
from when alfred also ran a Work instance, and stays so new backups land beside existing ones.

What the nightly job does, in this fixed order (a dump that fails to restore never
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
3. **Upload** — copies the SAME verified gzip to two keys: `daily/personal/YYYY-MM-DD.sql.gz` (one
   slot per UTC day; a same-day re-run overwrites) and `monthly/personal/YYYY-MM.sql.gz` (one slot
   per month; each daily run overwrites it, so it settles to the month's last good backup and freezes
   when the month rolls over).

Run it locally / as a restore drill with `INSTANCE=personal npm run backup -w database`
(needs the same env vars).

### One-time setup (do this once; the workflow is inert until it's done)

1. **Create one R2 bucket** (the instance segment sits *under* the tier prefix, so a single
   lifecycle rule covers it). Add **one object-lifecycle rule**: expire objects
   under the **`daily/`** prefix after **~35 days** (holds ~30 rolling dailies). Add
   **no rule** for `monthly/`, so monthly snapshots are kept indefinitely.
2. **Create an R2 API token** (S3 credentials) scoped to that bucket → gives an access key id, a
   secret access key, and the S3 endpoint URL (`https://<account-id>.r2.cloudflarestorage.com`).
3. **Add these GitHub Actions secrets** (repo → Settings → Secrets and variables → Actions — never
   commit or echo them):

   | Secret | Value |
   | --- | --- |
   | `SUPABASE_DB_URL_PERSONAL` | **Personal** instance's Supabase **Session pooler** URI (IPv4, port **5432**) — see the callout below |
   | `R2_ACCESS_KEY_ID` | R2 token's access key id |
   | `R2_SECRET_ACCESS_KEY` | R2 token's secret access key |
   | `R2_BUCKET` | the bucket name |
   | `R2_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |

4. **Trigger the workflow once** (Actions → Backup → *Run workflow*) to prove the path end-to-end;
   it should go green.

> **The Supabase URL — the non-obvious one.** `SUPABASE_DB_URL_PERSONAL` MUST be the
> **Session pooler** connection (IPv4, port **5432**). NOT the Direct connection (IPv6-only on the
> free tier → the IPv4-only Actions runner can't reach it) and NOT the Transaction pooler (port 6543
> → doesn't support `pg_dump`). Session mode is the one that is both reachable and
> `pg_dump`-compatible.

### Restoring from a backup

Download the object you want from R2 — a recent day from `daily/personal/`, or an older month from
`monthly/personal/` — and load it into the target
database. Because the dump is **full** (schema + data), this reconstructs everything with no
migration replay:

```bash
# List what's available, then pull one object (uses the R2 S3 credentials + endpoint):
aws s3 ls "s3://$R2_BUCKET/daily/personal/" --endpoint-url "$R2_ENDPOINT"
aws s3 cp "s3://$R2_BUCKET/daily/personal/2026-07-17.sql.gz" ./restore.sql.gz --endpoint-url "$R2_ENDPOINT"

# Restore into the target database (a fresh Supabase project, or a local cluster):
gunzip -c ./restore.sql.gz | psql "<target-db-url>"
```

The nightly verify step exercises exactly this restore path every day, so the procedure is
continuously proven, not aspirational.
