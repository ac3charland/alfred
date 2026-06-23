---
branch: alf-45-phase-0-schema
---

# ALF-45 Phase 0: recurring tasks schema

*2026-06-23T20:46:02.061Z*

Migration 0005_recurring_tasks.sql adds three nullable columns to the items table and an atomic complete_and_spawn RPC. Applied via psql against the live Supabase session-pooler; types regenerated with supabase@2.95.0.

```bash
source frontend/.env.local && psql "$DATABASE_URL" -c "\d items" 2>/dev/null | grep -E "recurrence|occurrence_index"
```

```output
 recurrence           | jsonb                    |           |          | 
 recurrence_series_id | uuid                     |           |          | 
 occurrence_index     | integer                  |           |          | 
    "items_recurrence_series_id_idx" btree (recurrence_series_id)
```

```bash
source frontend/.env.local && psql "$DATABASE_URL" -c "\df complete_and_spawn" 2>/dev/null
```

```output
                                                      List of functions
 Schema |        Name        | Result data type |                         Argument data types                         | Type 
--------+--------------------+------------------+---------------------------------------------------------------------+------
 public | complete_and_spawn | json             | root_id uuid, next_due timestamp with time zone, next_index integer | func
(1 row)
```

```bash
grep -E "recurrence|occurrence_index|complete_and_spawn" frontend/lib/database.types.ts | head -20
```

```output
          occurrence_index: number | null
          recurrence: Json | null
          recurrence_series_id: string | null
          occurrence_index?: number | null
          recurrence?: Json | null
          recurrence_series_id?: string | null
          occurrence_index?: number | null
          recurrence?: Json | null
          recurrence_series_id?: string | null
      complete_and_spawn: {
          occurrence_index: number | null
          recurrence: Json | null
          recurrence_series_id: string | null
          occurrence_index: number
          recurrence: Json
          recurrence_series_id: string
```
