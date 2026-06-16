# database — alfred schema & migrations

Supabase (PostgreSQL) schema for alfred. See `docs/specs/product/SPEC.md` §3 for the data model.

## Layout

- `migrations/` — ordered SQL migrations (`NNNN_name.sql`). Applied in filename order.
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
# Apply schema + seed (any Postgres client; example uses psql):
psql "$DATABASE_URL" -f database/migrations/0001_initial_schema.sql
psql "$DATABASE_URL" -f database/seed.sql

# Regenerate the TypeScript types after a schema change (Docker must be running; pin a
# mid-2.9x CLI — the latest CLI requires an access token for --db-url, see the supabase skill):
npx --yes supabase@2.95.0 gen types typescript --db-url "$DATABASE_URL" > frontend/lib/database.types.ts
```

Token-free `--db-url` introspection needs a local Docker `postgres-meta` container, so start
Docker first. The current CLI dropped the token-free path; pin `supabase@2.95.0`. See the
`supabase` skill ("Regenerating `database.types.ts`") for the version details.
