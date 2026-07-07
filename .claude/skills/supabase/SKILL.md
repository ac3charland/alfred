---
name: supabase
description: >
  Covers Supabase: querying or mutating the items/folders
  tables, Auth (login, session, getUser), RLS policies in SQL migrations, creating
  the Supabase client in Next.js Server Components / Route Handlers / middleware /
  browser components, generating TypeScript types, and recursive CTE queries for the
  subtask tree. Use on any import from @supabase/supabase-js or @supabase/ssr, any
  reference to the items or folders tables, or any mention of RLS, auth.uid(), the
  service_role key, the anon key, or Supabase env vars.
---

# Supabase Skill — alfred project

> Sources used in this skill:
> - Supabase JS SDK README (github.com/supabase/supabase-js, confirmed June 2026)
> - Supabase @supabase/ssr README (github.com/supabase/ssr, confirmed June 2026)
> - Supabase RLS AI prompt (github.com/supabase/supabase/examples/prompts/database-rls-policies.md)
> - Supabase gen types docs (supabase.com/docs/guides/api/rest/generating-types)
> - Supabase API key security docs (supabase.com/docs/guides/getting-started/api-keys)
> - PostgreSQL docs 18: §7.8 WITH Queries (postgresql.org/docs/current/queries-with.html)
> - Supabase auth-helpers deprecation notice (github.com/supabase/auth-helpers/DEPRECATED.md, April 2024)
> - VibeAppScanner service_role exposure report (vibeappscanner.com, January 2026)
> - Supabase first-party agent skill `supabase/agent-skills` (skills.sh, v0.1.2 — security
>   checklist, Data-API-exposure principle, and CLI/changelog operating rules folded in here)

---

## Contents

**This file**

- [Mental Model](#mental-model)
- [Decision Tree](#decision-tree)
- [Plain-English → Pattern Table](#plain-english--pattern-table)
- [Auth Lifecycle (onAuthStateChange)](#auth-lifecycle-onauthstatechange)
- [Common Pitfalls](#common-pitfalls)
- [Version Gotchas](#version-gotchas)
- [What Was Deliberately Left Out](#what-was-deliberately-left-out)
- [Quick Reference: Project Env Vars](#quick-reference-project-env-vars)

**Bundled resources**

- **references/**
  - [recursive-subtasks.md](./references/recursive-subtasks.md) — the `WITH RECURSIVE` CTE for a task's subtree
  - [rls-policies.md](./references/rls-policies.md) — full RLS policy templates

## Mental Model

Supabase is a Postgres-first backend-as-a-service. Every data operation goes through **PostgREST**, a REST layer that translates the supabase-js fluent API into SQL. Auth tokens are JWTs issued by the **GoTrue** auth server; those tokens flow through HTTP cookies (server-side) or localStorage (browser), and Postgres's `auth.uid()` function reads the JWT claim to enforce row-level security.

The most important mental model for alfred: **there is one Supabase project, one authenticated user, and RLS is the policy layer between the anon/authenticated JWT and your data.** The client SDK never executes SQL directly — it builds a PostgREST HTTP request. The only way to run arbitrary SQL (including recursive CTEs) is via `supabase.rpc()` calling a Postgres function, or via the Supabase CLI/migrations.

**The three-client model (Next.js App Router):**

```
Browser component  → createBrowserClient()   reads/writes cookies via JS
Server Component   → createServerClient()    reads cookies (can't set — read-only)
Middleware         → createServerClient()    reads AND sets cookies (refresh tokens here)
```

Server Components cannot write cookies, which means they cannot refresh expired access tokens. The middleware client is the only place token refresh is reliable — it runs before every render and writes the updated token cookie to the response. Without middleware doing `await supabase.auth.getUser()`, sessions silently expire for server-rendered pages.

**Key asymmetry:** `getUser()` makes a network round-trip to the Auth server and returns a verified user record. `getSession()` reads the JWT from local storage/cookies without re-validating against the server. **On the server, always use `getUser()`.** On the browser, `getSession()` is acceptable for UI state but not for authorization decisions.

---

## Decision Tree

**Which client to create?**

- Writing a `'use client'` component → `createBrowserClient()` from `@supabase/ssr`
- Writing an `async` Server Component or Server Action → `createServerClient()` with `cookies()` from `next/headers`
- Writing `middleware.ts` → `createServerClient()` with `request.cookies` / `response.cookies`
- Writing a Route Handler (`app/api/...`) → `createServerClient()` with `cookies()` (same as Server Component pattern)

**Which key to use?**

- Any client that runs in or can be reached from the browser → **anon key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`). Pair with RLS.
- Server-only admin work that must bypass RLS (e.g., a cron job, a migration seed script) → **service_role key** (`SUPABASE_SERVICE_ROLE_KEY`). Keep in server-only env var — never `NEXT_PUBLIC_`.

**Anon key + RLS vs service_role key?**

- Default everywhere → anon key + RLS. This is the only browser-safe path.
- The service_role key bypasses ALL RLS and grants full table access. It belongs only in server-side contexts that are never serialized to the client.

**Need to query a subtask tree to arbitrary depth?**

- JS-side recursive fetching (N+1 queries) → never
- Recursive CTE via a Postgres function, called with `supabase.rpc()` → correct approach

---

## Plain-English → Pattern Table

| When you need to... | Pattern | Key things to know |
|---|---|---|
| Fetch all items in the Inbox (no folder) | `supabase.from('items').select('*').is('folder_id', null).eq('status', 'active').order('created_at', { ascending: false })` | `.is('folder_id', null)` for NULL check — never `.eq('folder_id', null)`. `.eq()` on a null column returns zero rows. |
| Fetch items in a specific folder | `supabase.from('items').select('*').eq('folder_id', folderId).order('created_at', { ascending: false })` | `folderId` must be a valid UUID string. PostgREST coerces the string to `uuid` type. |
| Fetch a single item by id | `supabase.from('items').select('*').eq('id', id).single()` | `.single()` throws if 0 or 2+ rows match. Use `.maybeSingle()` when the row might not exist (returns `null` data instead of error). |
| Complete a task (update status + timestamp) | `supabase.from('items').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', id).select().single()` | `.update()` does NOT return data by default in v2 — chain `.select()` to get the updated row back. Always add a filter (`.eq('id', id)`) or you update every row. |
| Insert a new item/task | `supabase.from('items').insert({ title, item_type: 'task', status: 'active', folder_id: folderId ?? null }).select().single()` | Same as update: `.insert()` returns `{ data: null }` without `.select()`. `folder_id: null` places it in Inbox. |
| Upsert (insert or update by id) | `supabase.from('items').upsert({ id, ...fields }).select().single()` | Upsert matches on the primary key by default. Add `.select()` to get the resulting row. |
| Delete an item | `supabase.from('items').delete().eq('id', id)` | Delete returns `{ data: null, error }` — no rows returned unless you chain `.select()`. Always filter or you delete all rows (RLS may save you, but don't rely on it). |
| Get a task's full subtask tree (arbitrary depth) | Create a Postgres function using `WITH RECURSIVE`, call via `supabase.rpc('get_subtree', { root_id: id })` | See `references/recursive-subtasks.md` for the full SQL. PostgREST can't express recursive queries natively — you must use `rpc()`. |
| Require a logged-in user before returning data (server) | `const { data: { user } } = await supabase.auth.getUser()` then check `if (!user) redirect('/login')` | Use `getUser()` not `getSession()` on the server. `getSession()` does not validate the JWT against the Auth server and must not be used for authorization. |
| Get the current user in a browser component | `supabase.auth.getSession()` for UI state; `supabase.auth.onAuthStateChange()` to keep UI in sync | On the browser, `getSession()` is fine for display. For any server-side data authorization, rely on middleware + server `getUser()`. |
| Sign in with email (single-user app) | `supabase.auth.signInWithPassword({ email, password })` | Returns `{ data: { user, session }, error }`. The session cookie is set automatically by the browser client. |
| Sign out | `supabase.auth.signOut()` | Clears local session and broadcasts `SIGNED_OUT` to `onAuthStateChange` listeners. |
| Create an RLS policy (SQL migration) | `ALTER TABLE items ENABLE ROW LEVEL SECURITY; CREATE POLICY "owner access" ON items FOR ALL TO authenticated USING ((select auth.uid()) = user_id);` | Wrap `auth.uid()` in a `SELECT` subexpression — Postgres caches the result per statement (significant perf win). See `references/rls-policies.md` for full policy patterns. |
| Generate TypeScript types from schema | `npx supabase gen types typescript --project-id "$PROJECT_REF" --schema public > src/database.types.ts` then `createClient<Database>(url, key)` | Run after every migration. Use `Tables<'items'>`, `Enums<'item_type'>` helpers from the generated file rather than accessing the nested `Database['public']['Tables']['items']['Row']` type directly. |
| Push live row changes to an open browser (code module only) | `supabase.channel('code_items').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'code_items' }, handler).subscribe()`; tear down with `removeChannel(channel)` | The **only** realtime use in alfred — the webhook Worker is a second, non-browser writer of `factory_state`. **Subscribe to the base `code_items` table, not the `v_code_stories` view** (you can't subscribe to a view). Add the table to the `supabase_realtime` publication in a migration (`0003`); the existing `using (true)` policy governs the stream. Re-applying an echo of your own optimistic write is idempotent — no self-write filter. |
| Reorder rows by a single global rank (the Backlog, ALF-35) | A `bigint priority` column defaulted from a **global** `create sequence code_priority_seq` under a `unique(priority)` index; swap two rows in a `security invoker` RPC (`swap_code_priority`) via a **negative-sentinel sequence** — `set priority = -a_pri where ref=p_a; set priority = a_pri where ref=p_b; set priority = b_pri where ref=p_a` — so every per-row write is unique. | A *global* order needs **one** sequence, **not** the per-project `next_code_ref` (which would collide across projects). New rows append at the bottom via the column default (`nextval`). `security invoker` keeps RLS applying, matching the 0002/0004 RPCs. **Do NOT swap in one `update … case … end` statement under a plain unique index** — see the pitfall below; it 409s. |

---

## Auth Lifecycle (onAuthStateChange)

`supabase.auth.onAuthStateChange` fires in the browser on every auth event. The subscription must be cleaned up to prevent memory leaks in React.

```typescript
useEffect(() => {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    (event, session) => {
      // event: 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'PASSWORD_RECOVERY'
      if (event === 'SIGNED_OUT') router.push('/login')
    }
  )
  return () => subscription.unsubscribe()
}, [])
```

**Guarantee rules:**
- `SIGNED_IN` fires on initial load if a session cookie exists, and after `signInWithPassword` succeeds.
- `TOKEN_REFRESHED` fires when the access token is refreshed automatically. The browser client handles refresh automatically — you do not need to call `getUser()` in response to this event just to re-render.
- `SIGNED_OUT` fires after `signOut()` and after a refresh token is invalidated server-side.
- The `session` argument in the callback comes from local storage and is **not server-validated** — do not use it for authorization decisions in the handler.
- For alfred (single-user), a simple pattern is: on `SIGNED_OUT` redirect to `/login`; on `SIGNED_IN` redirect to `/`. No complex role logic needed.

---

## Common Pitfalls

- **Never use `.eq('column', null)` to find NULL rows.** PostgREST maps `eq` to `= null` which always returns zero rows. Always use `.is('column', null)`.

- **Never expose `SUPABASE_SERVICE_ROLE_KEY` as a `NEXT_PUBLIC_` variable.** It bypasses all RLS and grants full database control to anyone who can read your client bundle. 11% of public Supabase apps have been found to have this key exposed (VibeAppScanner, January 2026). Use it only in server-only env vars.

- **Always add `.select()` after `.insert()`, `.update()`, and `.upsert()` if you need the row back.** In supabase-js v2 these methods return `{ data: null }` by default — no row data unless you chain `.select()`.

- **Always add a `.eq()` (or other filter) to `.update()` and `.delete()`.** Without a filter, the operation targets every row in the table. RLS may partially protect you, but a missing filter is a correctness bug, not a security feature.

- **Never run recursive subtask queries in a JS loop.** Fetching children level-by-level results in N+1 queries. Use a `WITH RECURSIVE` CTE in a Postgres function and call it via `supabase.rpc()`.

- **Reading a view that returns a known-non-null row shape? Override the generated type with `.overrideTypes<Row[]>()`.** Postgres views carry no NOT NULL metadata, so `supabase gen types` types **every** view column as nullable — even a `select t.*` passthrough view whose rows are always full table rows. The result is a cryptic `Type 'string | null' is not assignable to type 'string'` on assignment to the table's `Row` type. Chain `.overrideTypes<Item[]>()` **after** the terminal builder method (e.g. `.order(...)`), not before — it's a type-only passthrough. (alfred's `task_items` view reads this way; see `lib/data/items.ts`.) Note `.overrideTypes` only fixes the **query result**; the shared alias for the view row (e.g. `CodeStory = Views['v_code_stories']['Row']`) stays all-nullable, so code consuming that alias (store actions, components) must still coalesce/narrow before passing a field to a `string`-typed param or template literal — else the same `string | null` error resurfaces away from the query.

- **Always use `await supabase.auth.getUser()` in middleware** (not `getSession()`). The middleware is where the access token is refreshed. Calling `getSession()` in middleware skips the refresh, causing Server Components to receive a stale or expired token.

- **Never mix `@supabase/auth-helpers-nextjs` and `@supabase/ssr` in the same project.** The auth-helpers package is deprecated (April 2024) and the two packages conflict on session state. If you see `createClientComponentClient` or `createServerComponentClient` in the codebase, those are the old API — migrate to `createBrowserClient` / `createServerClient`.

- **The `cookies()` import from `next/headers` is async in Next.js 15+.** Always `await cookies()` before passing to `createServerClient`. Forgetting the await causes a runtime error.

- **RLS `UPDATE` policies need both `USING` (which rows can be seen) and `WITH CHECK` (what the updated row must satisfy).** A policy with only `USING` allows reading the row but may silently fail writes that would move a row out of the policy's scope.

- **`create or replace view` can only APPEND columns — never reorder, retype, rename, or drop them.** To add a column to an existing view (e.g. `priority` on `v_code_stories`), put the new column at the **end** of the select list; anything else errors with `cannot change name/type of view column`. Drop-and-recreate only when you must restructure.

- **A `select *` / `select t.*` view freezes its column list at CREATE time** — a column ADDed to the base table *later* never appears in the view until you **recreate** it (`create or replace view … select t.*` re-expands `*` and appends the new column, per the rule above). The trap compounds with `.overrideTypes<Row[]>()`: the override *claims* the column is present so typecheck stays green, but the view returns rows without it → the field is `undefined` (not `null`) at runtime, slipping past a `!== null` guard and into a crash. `task_items` froze at `0002` and silently dropped `recurrence` (`0006`) and `priority` (`0010`) — every task read back `priority: undefined`, white-screening the tasks views — until `0011` recreated it. **After adding an `items` column, recreate `task_items` in the same migration.**

- **A single `UPDATE` is NOT immune to a unique violation when it swaps two rows' values.** A plain `unique` index / `UNIQUE` constraint is **non-deferrable**: Postgres checks it **per row, mid-statement**, not at statement end. So `update t set priority = case ref when p_a then b_pri when p_b then a_pri else priority end where ref in (p_a,p_b)` over a `unique(priority)` index **409s** — `duplicate key value violates unique constraint` — the moment it rewrites the first row to a value the second still holds (ALF-35's reorder bug, fixed in `0007`). Two fixes: (a) the **negative-sentinel sequence** in the swap table-row above — keeps the index immediate, no schema change; or (b) make the constraint `unique (priority) deferrable initially deferred` (a table CONSTRAINT, not a plain index — a bare `create unique index` can't be deferrable) so the check runs at commit and the one CASE update stands. The "one statement is atomic so it can't transiently duplicate" intuition is wrong for non-deferrable constraints.

### Security traps

These are Supabase-specific footguns that silently create vulnerabilities. alfred is single-user, so several are low-stakes here — but they apply the moment the schema grows a second user or a new table/view/function.

- **Never use `user_metadata` / `raw_user_meta_data` in authorization decisions.** It is **user-editable** and can appear in `auth.jwt()`, so anyone can rewrite it. Put authorization data in `app_metadata` / `raw_app_meta_data` (server-controlled) instead — never in an RLS policy keyed off `user_metadata`.

- **`SECURITY DEFINER` bypasses RLS — never reach for it to silence a permission error.** A definer function runs as its creator (usually a `bypassrls` role like `postgres`), so it silently removes access control instead of fixing the cause (the cause is almost always a missing GRANT — see the Data-API section above). alfred's `get_subtree` / `complete_subtree` are deliberately `SECURITY INVOKER` so the caller's RLS still applies — keep them that way. Also note Postgres grants `EXECUTE` to `PUBLIC` by default, so any `SECURITY DEFINER` function in `public` is callable by `anon`/`authenticated` with no extra grant — keep such functions out of exposed schemas and add an `auth.uid()` check in the body.

- **Views bypass RLS by default.** A plain view runs with the *view owner's* privileges, leaking rows past the underlying table's RLS. On Postgres 15+ create them `WITH (security_invoker = true)`; on older versions revoke `anon`/`authenticated` access or put the view in an unexposed schema. (alfred's Software-Factory views — `task_items`, `v_code_stories` — must stay `security_invoker`.)

- **`auth.role()` is deprecated — target the role with the policy's `TO` clause instead.** Beyond deprecation, `auth.role() = 'authenticated'` passes for anonymous sign-in users (they carry the `authenticated` Postgres role), so it silently fails open if anonymous auth is ever enabled.

- **Deleting an auth user does not invalidate their existing access tokens.** Revoke sessions / sign out first; rely on short JWT expiry. (Single-user alfred rarely deletes its one user, but worth knowing before any account-management feature.)

---

## Version Gotchas

### supabase-js v1 → v2 (still common in training data)

- **v1:** `.insert()`, `.update()`, `.upsert()` returned the affected rows automatically.
  **v2:** These return `{ data: null }` by default. Chain `.select()` to get rows back.

- **v1:** `.single()` returned a 406 error if no row found.
  **v2:** `.single()` returns a PostgrestError with code `PGRST116` for zero rows. Use `.maybeSingle()` for optional lookups.

- **v1 type generation used `@supabase/supabase-js`'s built-in types.**
  **v2:** Use `npx supabase gen types` from the CLI and pass `Database` generic to `createClient<Database>()`.

### @supabase/auth-helpers → @supabase/ssr (deprecated April 2024)

| Old (deprecated) | New (@supabase/ssr) |
|---|---|
| `createClientComponentClient()` | `createBrowserClient(url, key)` |
| `createServerComponentClient({ cookies })` | `createServerClient(url, key, { cookies: { getAll, setAll } })` |
| `createRouteHandlerClient({ cookies })` | `createServerClient(url, key, { cookies: { getAll, setAll } })` |
| `createMiddlewareClient({ req, res })` | `createServerClient(url, key, { cookies: { getAll, setAll } })` in middleware |

The `@supabase/ssr` cookie API changed from the single-method `get/set/remove` style to the batch `getAll/setAll` style. Code examples from before mid-2024 will use the old single-method form and will produce TypeScript errors against current `@supabase/ssr`.

---

## What Was Deliberately Left Out

- **Realtime beyond the code module.** Only `code_items` is subscribed (see the realtime row in the Plain-English table above — the Worker is its second, non-browser writer). Tasks/folders and `epics`/`projects` stay seed-once, and live cross-device INSERT/DELETE sync is not built.

- **Supabase Storage** (file uploads, buckets): not used in alfred's schema. Don't reach for `supabase.storage` unless a future feature explicitly requires it.

- **Edge Functions** (`supabase.functions.invoke()`): alfred's server logic lives in Next.js Route Handlers and Server Actions. Edge Functions are excluded to keep the stack simple.

- **`supabase.auth.admin.*` methods** (create/delete users, list all users): these require the service_role key and only belong in admin tooling, not application code.

- **Supabase Vault and Secrets**: not relevant to this project's schema.

- **Row-level security with multiple users / team patterns**: alfred is single-user. The RLS section covers the single-owner policy pattern only (all rows belong to the one authenticated user). Multi-tenant patterns (team_id, org_id, shared ownership) are omitted intentionally.

- **`ltree` / `materialized path` for subtask trees**: alfred uses the adjacency list (`parent_id` self-reference) which is simpler to write and maintains. Recursive CTEs handle arbitrary-depth reads. Nested sets and ltree are more complex and not needed here.

---

## Quick Reference: Project Env Vars

| Variable | Scope | Used for |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public (browser-safe) | PostgREST and Auth endpoint |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (browser-safe) | Authenticated by RLS policies |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only — never `NEXT_PUBLIC_` | Bypass RLS in trusted server scripts only |

### New API key format (`sb_publishable_…` / `sb_secret_…`)

As of the alfred project's Supabase project (provisioned June 2026), Supabase issues
**new-format API keys** that replace the legacy JWT anon/service_role keys:

- **Publishable key** `sb_publishable_…` → use as `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  (the browser-safe client key; replaces the legacy `anon` JWT). Works with
  `createBrowserClient` / `createServerClient` exactly where the anon key did.
- **Secret key** `sb_secret_…` → use as `SUPABASE_SERVICE_ROLE_KEY` (server-only;
  replaces the legacy `service_role` JWT). Bypasses RLS — never `NEXT_PUBLIC_`.
- The **legacy `service_role` JWT** (`eyJ…`) still works and is occasionally needed by
  older tooling; alfred keeps it in `SUPABASE_SERVICE_ROLE_JWT` (server-only) as a fallback.

Keep the env-var *names* canonical (`NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`) so app code stays generic; only the *values* are the new format.

### Operating note: Supabase moves fast — verify, don't trust training data

Function signatures, `config.toml` keys, and CLI subcommands change between Supabase
versions. Before implementing an unfamiliar feature, skim `https://supabase.com/changelog.md`
for relevant `breaking-change` tags and fetch the specific docs page (append `.md` to any
docs URL for the markdown version). Discover CLI commands with `--help` rather than guessing,
and always **verify a change with a follow-up query** — a fix without verification is incomplete.

### In the Claude Code web/remote sandbox, apply migrations via the Management API

The remote sandbox allows outbound **HTTPS only** (through the agent proxy); raw Postgres TCP
to the pooler (5432 **and** 6543) is blocked, so `npm run migrate`, `psql`, and `pg.Client`
all hang and fail with a bare `timeout expired`. When a `SUPABASE_ACCESS_TOKEN` (a PAT) is in
the environment, run migrations — and any ad-hoc SQL — over the **Management API** instead:

```bash
curl -sS -X POST "https://api.supabase.com/v1/projects/<ref>/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" \
  --data @body.json   # body.json = {"query":"<the migration SQL>"}
```

A multi-statement migration body applies in one call; success returns the last statement's
rows (`[]` for DDL), HTTP 201. Build `body.json` with `JSON.stringify` from the `.sql` file
rather than escaping by hand. The **project ref** is the `postgres.<ref>` username in
`DATABASE_URL`. This same endpoint is the way to verify a change afterwards (query
`information_schema` / `pg_constraint`), since no Postgres client can reach the DB directly.

### Applying migrations / generating types without a personal access token

Plain SQL migrations can be applied over the **session pooler** connection string (port
5432) with any Postgres client (`pg`, `psql`). The transaction pooler (6543) is unreliable
for multi-statement DDL — prefer the session pooler or direct connection for migrations.

To apply **one** migration to the live DB by number, use `npm run migrate -w database <NNNN>`
(accepts `11`, `0011`, or the full filename). It reads `DATABASE_URL` from `frontend/.env.local`,
prints the target host, and confirms before writing (`--yes` skips the prompt). It applies a
single file with no state tracking — fine because most migrations are idempotent-by-design or
applied once; reach for raw `psql -f` for the schema bootstrap or seed.

**Regenerating `database.types.ts` from `--db-url` is CLI-version-sensitive — pin a mid-2.9x
version and have Docker running.** Token-free `--db-url` introspection only works on CLI
versions that spin up a local Docker `postgres-meta` container, so **start Docker Desktop first**
(`open -a Docker`, then poll `until docker info; do sleep 2; done`):

```bash
npx --yes supabase@2.95.0 gen types typescript --db-url "$DATABASE_URL" > frontend/lib/database.types.ts
```

- **The current CLI (2.106.0) dropped the token-free path** — `gen types --db-url` errors
  `LegacyPlatformAuthRequiredError` ("Access token not provided"), demanding `supabase login` /
  `SUPABASE_ACCESS_TOKEN`. Don't reach for `@latest` here.
- **Very old versions (≤2.40.x) work token-free via Docker but emit an outdated type format**
  (no `SetofOptions`, drops `graphql_public` when you pass `--schema public`) → noisy format
  churn vs. the committed file.
- **2.6x–2.9x are the sweet spot:** token-free, Docker-based, and emit the *current* format
  (`SetofOptions`, `graphql_public`, `__InternalSupabase`). Omit `--schema` so all exposed
  schemas are included.

**Direct connection is IPv6-only — use the session pooler from IPv4 networks.** The
`DATABASE_URL` from the dashboard's *Direct connection* tab points at
`db.<ref>.supabase.co`, which publishes **only an AAAA (IPv6) record**. On an IPv4-only
machine (most home/CI networks) `psql` fails with `could not translate host name … to
address`. Fix: use the **Session pooler** URI, which is IPv4-proxied for free:

```
postgresql://postgres.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:5432/postgres
```

The pooler user is `postgres.<project-ref>` (not bare `postgres`), and the host is
`aws-0-` **or** `aws-1-<region>` — try both; the wrong tenant prefix errors with
`Tenant or user not found`. If you don't know the region, map the project's IPv6 (from
`nslookup -type=AAAA db.<ref>.supabase.co`) against AWS's published `ip-ranges.json`, or
just read it off the dashboard's Session-pooler string. alfred stores the pooler URI in
`frontend/.env.local` as `DATABASE_URL` (gitignored).

### Raw `psql -f migration.sql` does NOT get Supabase's auto-grants

When you apply a migration through `supabase db push` or the dashboard SQL editor,
Supabase auto-grants table privileges to `anon` / `authenticated` / `service_role`. When
you apply the **same SQL with raw `psql` as the pooler `postgres` user**, those roles get
only `REFERENCES, TRIGGER, TRUNCATE` — **not** `SELECT/INSERT/UPDATE/DELETE`. Symptom: the
app and the service-role ingress both 500 with **`permission denied for table items`**
even though RLS policies look correct (RLS gates *which rows*; table GRANTs gate *whether
the role may touch the table at all* — you need both). Every migration applied via `psql`
must therefore include explicit grants, e.g.:

```sql
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on items, folders to anon, authenticated, service_role;
grant execute on function get_subtree(uuid), complete_subtree(uuid) to anon, authenticated, service_role;
```

`anon` stays locked out by RLS (no policy), `authenticated` is gated by its policy, and
`service_role` bypasses RLS — so granting DML to all three is safe. GRANTs are idempotent,
so it's fine to re-run them on an already-provisioned DB.

Supabase frames this as **Data API exposure**: a table created by raw SQL is only reachable
through PostgREST once the API roles have been GRANTed access, and the project's *Data API
settings* (dashboard → Integrations → Data API) decide whether new tables are auto-exposed.
This is **separate from RLS** — GRANTs decide whether a role may touch the table at all; RLS
decides which rows it sees once it can. Always pair public grants with RLS enabled. See
[Exposing a Table to the Data API](https://supabase.com/docs/guides/api/securing-your-api.md).

**Guardrails for this class (the JS mock can't catch it).** Two checks gate the grant / RLS /
constraint bugs that only manifest in real Postgres: `migration-lint` (`check:fast`) statically
fails the build if a `create sequence` lacks a USAGE grant to the API roles (the `0005`→`0008`
500); and the **`database` integration suite** (`check:slow` — `npm run check:slow -w database`,
`src/run.ts`) spins up a throwaway Postgres, seeds the Supabase-provided objects (the three API
roles + the `supabase_realtime` publication 0003 needs), applies **every** migration in order,
and asserts each RPC as the real `authenticated` / `anon` roles via `SET ROLE` — so a missing
grant, an RLS gap, or a non-deferrable-unique 409 (the `0007` swap bug) is a red gate, not a
shipped 500. Add a regression there for any new DB-semantics bug. See the `migration-lint` and
`backpressure` skills.

> See `references/` for detailed SQL patterns: `references/rls-policies.md` for policy templates, `references/recursive-subtasks.md` for the WITH RECURSIVE CTE.
