---
name: supabase
description: >
  Use when writing any code that touches Supabase in the alfred project:
  querying or mutating the items/folders tables, handling Auth (login,
  session, getUser), writing RLS policies in SQL migrations, creating the
  Supabase client in Next.js Server Components / Route Handlers / middleware
  / browser components, generating TypeScript types, or running recursive
  CTE queries for the subtask tree. Trigger on: any import from
  @supabase/supabase-js or @supabase/ssr, any reference to the items or
  folders tables, any mention of RLS, auth.uid(), service_role key, anon
  key, or Supabase env vars.
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

---

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

- **`.is('column', null)` conflicts with `unicorn/no-null` when the rule has `checkArguments: true`.** The Supabase `.is()` type signature is `(column: string, value: boolean | null): this` — `null` is mandatory. If the project's ESLint config has `unicorn/no-null` with `checkArguments: true` and you cannot use `eslint-disable`, use `const DB_NULL = undefined as unknown as null` and pass `DB_NULL` instead. This preserves the correct runtime value while satisfying the linter. Flag to the project lead so the ESLint config can be updated to either `checkArguments: false` or add an exception for the Supabase API layer.

- **Never expose `SUPABASE_SERVICE_ROLE_KEY` as a `NEXT_PUBLIC_` variable.** It bypasses all RLS and grants full database control to anyone who can read your client bundle. 11% of public Supabase apps have been found to have this key exposed (VibeAppScanner, January 2026). Use it only in server-only env vars.

- **Always add `.select()` after `.insert()`, `.update()`, and `.upsert()` if you need the row back.** In supabase-js v2 these methods return `{ data: null }` by default — no row data unless you chain `.select()`.

- **Always add a `.eq()` (or other filter) to `.update()` and `.delete()`.** Without a filter, the operation targets every row in the table. RLS may partially protect you, but a missing filter is a correctness bug, not a security feature.

- **Never run recursive subtask queries in a JS loop.** Fetching children level-by-level results in N+1 queries. Use a `WITH RECURSIVE` CTE in a Postgres function and call it via `supabase.rpc()`.

- **Always use `await supabase.auth.getUser()` in middleware** (not `getSession()`). The middleware is where the access token is refreshed. Calling `getSession()` in middleware skips the refresh, causing Server Components to receive a stale or expired token.

- **Never mix `@supabase/auth-helpers-nextjs` and `@supabase/ssr` in the same project.** The auth-helpers package is deprecated (April 2024) and the two packages conflict on session state. If you see `createClientComponentClient` or `createServerComponentClient` in the codebase, those are the old API — migrate to `createBrowserClient` / `createServerClient`.

- **The `cookies()` import from `next/headers` is async in Next.js 15+.** Always `await cookies()` before passing to `createServerClient`. Forgetting the await causes a runtime error.

- **RLS `UPDATE` policies need both `USING` (which rows can be seen) and `WITH CHECK` (what the updated row must satisfy).** A policy with only `USING` allows reading the row but may silently fail writes that would move a row out of the policy's scope.

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

- **Realtime subscriptions** (`supabase.channel()`, `.on('postgres_changes', ...)`): alfred is a personal app with one user on one device at a time; realtime adds complexity with no benefit. If concurrent-device sync is ever needed, add it then.

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

### Applying migrations / generating types without a personal access token

`supabase gen types typescript --db-url "<postgres-connection-string>"` introspects the
live DB directly — no `--project-id` + personal access token needed. Likewise, plain SQL
migrations can be applied over the **session pooler** connection string (port 5432) with
any Postgres client (`pg`, `psql`). The transaction pooler (6543) is unreliable for
multi-statement DDL — prefer the session pooler or direct connection for migrations.

> See `references/` for detailed SQL patterns: `references/rls-policies.md` for policy templates, `references/recursive-subtasks.md` for the WITH RECURSIVE CTE.
