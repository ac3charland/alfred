---
branch: claude/eager-darwin-9vu2rk
---

# Real-Postgres guardrails: integration suite + migration-lint

*2026-06-24T15:50:31.128Z*

Two shipped 500s (`0008` a missing sequence grant, `0007` a non-deferrable-unique 409) lived entirely in real-Postgres semantics the JS Supabase mock can't reproduce, so no existing test caught them. Two guardrails now close the gap:

1. **`tools/migration-lint`** (static, `check:fast`) — its `sequence-grant` rule. 2. **`database` integration suite** (`npm run test:integration -w database`, `check:slow`) — stands up a throwaway Postgres, seeds the Supabase-provided objects (the three API roles + the `supabase_realtime` publication), applies every migration in order, then asserts each RPC as the real `authenticated`/`anon` roles via `SET ROLE`.

Below: both run GREEN on the committed migrations (the integration suite's `create_code_story` line is the live proof the 0008 fix works), then RED against a temp fixture with 0008's grant removed — reproducing the exact `permission denied for sequence code_priority_seq`. The repo's migrations are never touched; the reproduction is self-contained in this block (no committed throwaway script).

```bash
echo "== migration-lint — committed migrations (GREEN) =="
npm run --silent lint:migrations -w tools/migration-lint 2>/dev/null | grep 'migration-lint:'
echo
echo "== integration suite — committed migrations (GREEN) =="
npm run --silent test:integration -w database 2>/dev/null | grep -E '✓|db-integration:'
echo
fix=$(mktemp -d); cp database/migrations/*.sql "$fix"; rm "$fix"/0008_*.sql
echo "== migration-lint — fixture without 0008 (RED) =="
npm run --silent lint:migrations -w tools/migration-lint -- "$fix" 2>/dev/null | grep -oE 'sequence [a-z_]+ \(created in [^)]+\) is missing USAGE grants for: [^.]+\.|migration-lint: [0-9]+ error' || true
echo
echo "== integration suite — fixture without 0008 (RED: the 500) =="
ALFRED_MIGRATIONS_DIR="$fix" npm run --silent test:integration -w database 2>/dev/null | grep -E '✗ create_code_story|↳ permission denied|db-integration:' || true
rm -rf "$fix"
```

```output
== migration-lint — committed migrations (GREEN) ==
migration-lint: 0 error(s), 0 warning(s).

== integration suite — committed migrations (GREEN) ==
✓ create_code_story allocates a priority (0008 sequence grant) — ref=ALF-1 priority=1
✓ enter_code_module allocates a priority (sequence grant) — ref=ALF-2 priority=2
✓ swap_code_priority swaps adjacent ranks without a 409 (0007) — ALF-3:3→4, ALF-4:4→3
✓ anon cannot insert (RLS write denial) — anon insert rejected by RLS
✓ anon sees zero code_items rows despite rows existing (RLS read) — admin sees 4, anon sees 0
db-integration: 5/5 passed.

== migration-lint — fixture without 0008 (RED) ==
sequence code_priority_seq (created in 0005_story_priority.sql) is missing USAGE grants for: anon, authenticated, service_role.
migration-lint: 1 error

== integration suite — fixture without 0008 (RED: the 500) ==
✗ create_code_story allocates a priority (0008 sequence grant)
    ↳ permission denied for sequence code_priority_seq
    ↳ permission denied for sequence code_priority_seq
    ↳ permission denied for sequence code_priority_seq
db-integration: 1/5 passed.
```
