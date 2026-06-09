# RLS Policy Patterns — alfred project

> Source: Supabase RLS AI prompt (github.com/supabase/supabase/examples/prompts/database-rls-policies.md)
> Source: Supabase Row Level Security docs (supabase.com/docs/guides/database/postgres/row-level-security)
> Confirmed June 2026.

## PROJECT RULE — RLS is mandatory (treat as a §9.4 guardrail)

The alfred Supabase project has **automatic / deny-by-default RLS enabled at project
creation**. This is a deliberate security decision, not a default to optimize away:

- **Every new table MUST `ENABLE ROW LEVEL SECURITY` and have an explicit policy.** A
  table without a policy is fully inaccessible via the Data API (deny by default).
- **WHY:** the publishable key ships to the browser and is public. RLS — not the Next.js
  auth gate — is what stops a leaked publishable key from reading/writing Postgres
  directly through the Data API. The auth gate only guards the UI.
- **Single-user → role-based, not row-based.** items/folders have **no `user_id` column**
  (intentional). Use the `authenticated full access` (`using (true) with check (true)`)
  variant below. Do NOT add `user_id` / `auth.uid() = user_id` policies.
- **The secret key bypasses RLS by design.** Server-side code (API routes, Workers) uses
  the secret key and ignores all policies. RLS only protects the publishable-key/browser
  path. This asymmetry is intentional — do NOT disable RLS or delete policies because
  "the server bypasses them anyway."
- **Never disable RLS or remove a policy to make something work.** Fix the access path.

## Core concepts

**Row Level Security (RLS)** filters rows at the Postgres level before they reach the application. When enabled on a table, every query from a non-superuser role passes through the policies before returning data.

`auth.uid()` returns the UUID from the authenticated user's JWT. In alfred (single-user), this is always the owner's UUID.

**Two clauses:**
- `USING (expr)` — filters which existing rows can be read/updated/deleted (evaluated against the current row)
- `WITH CHECK (expr)` — validates that a new or modified row satisfies the condition (evaluated against the proposed row after the write)

SELECT and DELETE use only `USING`. INSERT uses only `WITH CHECK`. UPDATE typically needs both.

**Performance tip:** Wrap `auth.uid()` in a `SELECT` subexpression. Postgres caches the result per statement, avoiding re-evaluation per row:
```sql
-- SLOW (re-evaluated for each row):
USING (auth.uid() = user_id)

-- FAST (cached per statement):
USING ((select auth.uid()) = user_id)
```

## alfred schema: single-owner pattern

Since alfred has one user, policies are simple: the authenticated user can access all rows; the anon role cannot.

### items table

```sql
-- Enable RLS (required before any policy takes effect)
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

-- SELECT: owner can read all their items
CREATE POLICY "authenticated read own items"
ON items FOR SELECT
TO authenticated
USING ((select auth.uid()) = user_id);

-- INSERT: owner can insert rows they own
CREATE POLICY "authenticated insert own items"
ON items FOR INSERT
TO authenticated
WITH CHECK ((select auth.uid()) = user_id);

-- UPDATE: owner can update their own rows, and the updated row must still be theirs
CREATE POLICY "authenticated update own items"
ON items FOR UPDATE
TO authenticated
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);

-- DELETE: owner can delete their own rows
CREATE POLICY "authenticated delete own items"
ON items FOR DELETE
TO authenticated
USING ((select auth.uid()) = user_id);
```

Note: this requires a `user_id uuid references auth.users(id)` column on `items`. If your schema doesn't have `user_id`, use the simpler "authenticated users can do anything" variant below.

### Simpler variant: single-user, no per-row user_id column

If you rely on application-layer auth (middleware + `getUser()`) and don't need per-row user tracking:

```sql
ALTER TABLE items ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read/write all items
-- (safe for single-user, wrong for multi-user)
CREATE POLICY "authenticated full access"
ON items FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
```

This still blocks unauthenticated (anon) access, which is the main value for a personal app.

### folders table

Same pattern as items:

```sql
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated full access"
ON folders FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
```

## Checking policy behavior

After applying policies, test with the Supabase SQL editor using `SET LOCAL role = 'anon';` or `SET LOCAL role = 'authenticated';` to simulate each role. Or use the Supabase dashboard's Table Editor which respects RLS.

## Service-role key bypasses RLS

Any client created with the `service_role` key ignores all RLS policies. This is intentional for admin operations but means:
- Never use the service_role key in browser code.
- Never pass it as a `NEXT_PUBLIC_` env var.
- Never log it or include it in error messages sent to the client.

If you need to bypass RLS in a trusted server context (e.g., a data migration), create a separate admin client:

```typescript
// server-only — never import this in a browser component or page
import { createClient } from '@supabase/supabase-js'

export const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!  // NOT NEXT_PUBLIC_ — never exposed to browser
)
```

## Common RLS mistakes

- **Forgetting `WITH CHECK` on UPDATE**: the policy allows reading the row but silently rejects writes that would move a row out of the policy's scope.
- **Policies on a table with RLS disabled**: `CREATE POLICY` succeeds but policies have no effect until `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is run.
- **Using `eq` instead of `is` in policies for nullable columns**: `auth.uid() = user_id` in SQL is fine (SQL `=`, not PostgREST `.eq()`), but if `user_id` is nullable, you may want `user_id IS NOT DISTINCT FROM auth.uid()` to handle the null case explicitly.
- **Using `SECURITY DEFINER` on functions called from policies**: this can inadvertently bypass RLS inside the function body.
