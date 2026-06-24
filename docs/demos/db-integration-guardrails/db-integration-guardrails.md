---
branch: claude/eager-darwin-9vu2rk
---

# Real-Postgres guardrails: integration suite + migration-lint

*2026-06-24T15:24:06.697Z*

Two shipped 500s (`0008` a missing sequence grant, `0007` a non-deferrable-unique 409) lived entirely in real-Postgres semantics the JS Supabase mock can't reproduce, so no existing test caught them. This adds two guardrails that close the gap:

1. **`tools/migration-lint`** (static, runs in `check:fast`) — its `sequence-grant` rule fails the build when a `create sequence` lacks a `grant usage … to anon, authenticated, service_role`. Cheap, no container; catches the grant class at commit time.

2. **`database` integration suite** (`src/run.ts`, runs in `check:slow`) — stands up a throwaway Postgres, seeds the Supabase-provided objects (the three API roles + the `supabase_realtime` publication), applies **every** migration in filename order exactly as prod does, then asserts each RPC as the real `authenticated`/`anon` roles via `SET ROLE`. Each known bug is a one-line regression here.

Below, both guardrails run GREEN on the committed migrations, then RED against a fixture (a temp copy) with 0008's grant removed — the repo's migrations are never touched. The integration suite's RED run reproduces the exact `permission denied for sequence code_priority_seq` 500.

```bash
bash database/scripts/demo-db-guardrails.sh
```

```output
== migration-lint — committed migrations (GREEN) ==
migration-lint: 0 error(s), 0 warning(s).

== migration-lint — 0008 grant missing (RED) ==
sequence code_priority_seq (created in 0005_story_priority.sql) is missing USAGE grants for: anon, authenticated, service_role.
migration-lint: 1 error

== integration suite — committed migrations (GREEN) ==
✓ create_code_story allocates a priority (0008 sequence grant) — ref=ALF-1 priority=1
✓ enter_code_module allocates a priority (sequence grant) — ref=ALF-2 priority=2
✓ swap_code_priority swaps adjacent ranks without a 409 (0007) — ALF-3:3→4, ALF-4:4→3
✓ anon cannot insert (RLS write denial) — anon insert rejected by RLS
✓ anon sees zero code_items rows despite rows existing (RLS read) — admin sees 4, anon sees 0
db-integration: 5/5 passed.

== integration suite — 0008 grant missing (RED) ==
✗ create_code_story allocates a priority (0008 sequence grant)
    ↳ permission denied for sequence code_priority_seq
✗ enter_code_module allocates a priority (sequence grant)
    ↳ permission denied for sequence code_priority_seq
✗ swap_code_priority swaps adjacent ranks without a 409 (0007)
    ↳ permission denied for sequence code_priority_seq
✓ anon cannot insert (RLS write denial) — anon insert rejected by RLS
✗ anon sees zero code_items rows despite rows existing (RLS read)
    ↳ precondition failed: no code_items to test RLS against
db-integration: 1/5 passed.
```
