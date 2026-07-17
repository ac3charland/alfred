# database — alfred schema & migrations

Supabase (PostgreSQL) schema for alfred. See `docs/specs/product/SPEC.md` §3 for the data model.

## Layout

- `migrations/` — ordered SQL migrations (`NNNN_name.sql`). Applied in filename order.
- `migrations-applied.log` — committed paper trail of which migrations reached a live DB (appended
  by `npm run migrate`; commit it). Guards against the migration-drift class that caused ALF-119/124.
- `seed.sql` — tiny development dataset (folders + a nested subtask tree).

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

## Applying to the hosted project

Env values live in `frontend/.env.local` (gitignored). Prefer the **Direct connection**
URI (it's IPv6 and works from a normal machine). If your network is IPv4-only, use the
**Session pooler** string (port 5432) instead — not the transaction pooler (6543), which
is unreliable for multi-statement DDL.

```bash
# Apply ONE migration to the live DB by number — reads DATABASE_URL from frontend/.env.local,
# prints the target host, and confirms before writing (add --yes to skip the prompt):
npm run migrate -w database 11           # accepts 11, 0011, or 0011_task_items_view_columns.sql
# On success it appends a line to database/migrations-applied.log (the paper trail of what reached
# a live DB) — COMMIT that change so the branch records the apply.

# Or drive any file directly with psql (schema bootstrap, seed, a hand-picked migration):
psql "$DATABASE_URL" -f database/migrations/0001_initial_schema.sql
psql "$DATABASE_URL" -f database/seed.sql

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
- **`npm run lint:migrations -w tools/migration-lint`** (via the root `check:fast`) — a
  static linter; its `sequence-grant` rule fails the build if a `create sequence` lacks a
  `grant usage … to anon, authenticated, service_role`. Cheap, no container; catches the
  grant class at commit time. See the `migration-lint` skill.
