---
branch: apply-migration-23
---

# Apply migration 0023 (habits) & fix .DS_Store gitignore

*2026-07-29T15:24:35.604Z*

Migration 0023 (habits, ALF-146/147) applied to the dev database — logged in migrations-applied.log so the apply history stays authoritative.

```bash
tail -3 database/migrations-applied.log
```

```output
2026-07-25T23:58:21.973Z	api.supabase.com/v1/projects/pobfpuohktigmnkcqwga (management api)	0022_weekly_plans.sql
2026-07-26T03:44:12.000Z	api.supabase.com/v1/projects/pobfpuohktigmnkcqwga (management api)	0021_blocked_from.sql
2026-07-29T15:19:27.414Z	aws-1-us-east-2.pooler.supabase.com:5432	0023_habits.sql
```

Also fixed .gitignore: the previous **/*.DS_Store/ pattern only matches directories named .DS_Store, never the actual files Finder writes, so docs/.DS_Store and docs/specs/.DS_Store kept showing up as untracked. A bare .DS_Store entry (unanchored, so it applies at any depth) actually ignores them.

```bash
git status --porcelain docs/ | grep -i ds_store || echo 'no .DS_Store files tracked or untracked'
```

```output
no .DS_Store files tracked or untracked
```
