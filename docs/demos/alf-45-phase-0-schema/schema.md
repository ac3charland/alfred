---
branch: alf-45-phase-0-schema
---

# ALF-45 Phase 0: recurring tasks schema

*2026-06-23T22:40:42.330Z*

Migration `0006_recurring_tasks.sql` adds three nullable columns to the `items` table (`recurrence jsonb`, `recurrence_series_id uuid`, `occurrence_index int`), an index on `recurrence_series_id`, and the atomic `complete_and_spawn` RPC. The columns and RPC are reflected in the regenerated `database.types.ts`.

```bash
grep -nE 'add column|create index|function complete_and_spawn' database/migrations/0006_recurring_tasks.sql
```

```output
9:  add column recurrence jsonb,
10:  add column recurrence_series_id uuid,
11:  add column occurrence_index int;
14:create index items_recurrence_series_id_idx on items (recurrence_series_id);
84:create or replace function complete_and_spawn(
175:grant execute on function complete_and_spawn(uuid, timestamptz, int)
```

```bash
grep -E 'occurrence_index|recurrence|complete_and_spawn' frontend/lib/database.types.ts
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
