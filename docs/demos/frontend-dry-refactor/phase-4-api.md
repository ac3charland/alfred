---
branch: worktree-dry-frontend
---

# Phase 4 — API route handler DRY + correctness

*2026-06-19T20:58:42.112Z*

Phase 4 extracts the request-parse / validate / error-map boilerplate that was copy-pasted across the 9 route handlers into a small shared `lib/api/` layer: `parsing.ts` (JSON-body + query parsing → 400 on malformed input), `updates.ts` (build a partial update object), `params.ts` (`parseUUID` for dynamic segments), and `supabase-errors.ts` (`mapSupabaseError`). Every handler now adopts these helpers, so behavior is consistent instead of ad-hoc per route.

Two intended BEHAVIOR deltas come with this phase (both net-new rejections of currently-malformed input — see SPEC D4 & D6):

**D4 — consistent DB-error mapping.** `mapSupabaseError` maps Postgres `23505` unique_violation → **409 Conflict** and `23503` foreign_key_violation → **400 Bad Request** in *every* handler. Previously only `/api/projects` mapped a unique violation; every other handler flattened these to a 500.

**D6 — UUID path-param validation.** `parseUUID` validates dynamic UUID segments (`items/[id]`, `folders/[id]`, `epics/[id]`, `tasks/[id]/complete`) up front, returning **400** on a malformed id instead of the previous misleading no-op success. `code/[ref]` is a human ref (e.g. `ALF-42`), not a UUID, so it is deliberately NOT validated this way.

The whole `app/api` route-test suite proves the DRY adoption left every handler green and exercises the two deltas. Run it and read the deterministic summary:

```bash
npm run --silent test -w frontend -- --silent --json app/api 2>/dev/null \
  | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(`suites: ${d.numPassedTestSuites}/${d.numTotalTestSuites} | tests: ${d.numPassedTests}/${d.numTotalTests} | failures: ${d.numFailedTests}`)'
```

```output
suites: 10/10 | tests: 138/138 | failures: 0
```

The two deltas are pinned by named tests. List them so a reviewer can see the exact rejections that are now asserted:

```bash
cd frontend
echo "D4 — unique_violation (23505) → 409:"
grep -rh "it('returns 409" app/api --include=route.test.ts | sed "s/^ *//;s/, async.*//"
echo
echo "D4 — foreign_key_violation (23503) → 400:"
grep -rh "foreign-key violation" app/api --include=route.test.ts | grep "it(" | sed "s/^ *//;s/, async.*//"
echo
echo "D6 — malformed UUID path param → 400 (count by route):"
grep -rl "returns 400 when the id is not a valid UUID" app/api --include=route.test.ts | sort
```

```output
D4 — unique_violation (23505) → 409:
it('returns 409 on a unique-constraint violation (duplicate key)'
it('returns 409 on a unique-constraint violation (23505)'

D4 — foreign_key_violation (23503) → 400:
it('returns 400 on a foreign-key violation'
it('returns 400 on a foreign-key violation (23503)'

D6 — malformed UUID path param → 400 (count by route):
app/api/epics/[id]/route.test.ts
app/api/folders/[id]/route.test.ts
app/api/items/[id]/route.test.ts
app/api/tasks/[id]/complete/route.test.ts
```
