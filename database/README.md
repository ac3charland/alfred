# database — alfred schema & migrations

Supabase (PostgreSQL) schema for alfred. See `docs/SPEC.md` §3 for the data model.

## Layout

- `migrations/` — ordered SQL migrations (`NNNN_name.sql`). Applied in filename order.
- `seed.sql` — tiny development dataset (folders + a nested subtask tree).

## Schema summary

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

## Applying to the hosted project

Env values live in `frontend/.env.local` (gitignored). Prefer the **Direct connection**
URI (it's IPv6 and works from a normal machine). If your network is IPv4-only, use the
**Session pooler** string (port 5432) instead — not the transaction pooler (6543), which
is unreliable for multi-statement DDL.

```bash
# Apply schema + seed (any Postgres client; example uses psql):
psql "$DATABASE_URL" -f database/migrations/0001_initial_schema.sql
psql "$DATABASE_URL" -f database/seed.sql

# Regenerate the TypeScript types after a schema change:
npx supabase gen types typescript --db-url "$DATABASE_URL" > frontend/lib/database.types.ts
```

`--db-url` introspects the live DB directly, so no Supabase personal access token is
required — only the connection string.
