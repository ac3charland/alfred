---
branch: chore/renumber-0009-migration
---

# Renumber task-priority migration & regenerate types

*2026-06-24T22:09:56.608Z*

Migration 0009 collided: two files shared the prefix. The code-priority RPC keeps 0009; the task-priority migration is renumbered to 0010 so the apply order is unambiguous.

```bash
ls database/migrations | grep -E '0008|0009|0010'
```

```output
0008_grant_priority_seq.sql
0009_move_code_priority.sql
0010_task_priority.sql
```

0010 adds the discrete `priority` column to `items` (ALF-37). The regenerated Supabase types now carry it on the items table Row/Insert/Update:

```bash
grep -n 'task_priority' frontend/lib/database.types.ts | head -8
```

```output
193:          priority: Database["public"]["Enums"]["task_priority"] | null
211:          priority?: Database["public"]["Enums"]["task_priority"] | null
229:          priority?: Database["public"]["Enums"]["task_priority"] | null
444:          priority: Database["public"]["Enums"]["task_priority"] | null
627:      task_priority: "high" | "medium" | "low"
771:      task_priority: ["high", "medium", "low"],
```
