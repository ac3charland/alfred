---
branch: claude/eager-darwin-9vu2rk
---

# Fix code-story creation 500 from missing sequence grant

*2026-06-24T05:00:10.324Z*

Creating a code story — the "New story" modal (`create_code_story`) or sending an item into the factory (`enter_code_module`) — 500'd with `permission denied for sequence code_priority_seq`.

Root cause: migration 0005 added `code_items.priority bigint not null default nextval('code_priority_seq')` but never GRANTed the new sequence to the API roles. Both insert RPCs are `security invoker`, so the column default's `nextval()` runs as the calling `authenticated` role, which needs USAGE on the sequence. Raw `psql -f` apply doesn't get Supabase's auto-grants, so every migration must grant explicitly — 0005 was the one that forgot. Migration 0008 adds the missing grant.

The proof below stands up a hermetic throwaway Postgres, creates the Supabase API roles, applies the real migrations as production does (raw `psql -f`, filename order), then runs `create_code_story` as the `authenticated` role BEFORE and AFTER 0008. This is exactly the real-Postgres check the JS mock (`frontend/scripts/mock-supabase.mjs`) can't perform — it never executes migrations or enforces grants.

```bash
bash database/scripts/repro-priority-grant.sh
```

```output
BEFORE 0008 — create_code_story as authenticated:
ERROR:  permission denied for sequence code_priority_seq

AFTER 0008 — create_code_story as authenticated:
ref | factory_state | priority
ALF-1 | needs_refinement | 1
```
