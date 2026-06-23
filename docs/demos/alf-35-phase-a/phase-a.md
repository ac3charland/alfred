---
branch: alf-35-phase-a
---

# ALF-35 Phase A: global story priority migration

*2026-06-23T19:57:21.344Z*

Migration 0005_story_priority.sql applied to the live Supabase project. Adds a global `priority` column to `code_items` (driven by a dedicated sequence), backfills 41 existing rows, enforces uniqueness, creates the `swap_code_priority` RPC, and appends `priority` to the `v_code_stories` view.

```bash
psql 'postgresql://postgres.pobfpuohktigmnkcqwga:B94HRFut5WFr65Un@aws-1-us-east-2.pooler.supabase.com:5432/postgres' -c "select column_name, data_type, column_default, is_nullable from information_schema.columns where table_name='code_items' and column_name='priority'" 2>&1
```

```output
 column_name | data_type |             column_default             | is_nullable 
-------------+-----------+----------------------------------------+-------------
 priority    | bigint    | nextval('code_priority_seq'::regclass) | NO
(1 row)
```

```bash
psql 'postgresql://postgres.pobfpuohktigmnkcqwga:B94HRFut5WFr65Un@aws-1-us-east-2.pooler.supabase.com:5432/postgres' -c "select min(priority), max(priority), count(*) from code_items" 2>&1
```

```output
 min | max | count 
-----+-----+-------
   1 |  41 |    41
(1 row)
```

```bash
psql 'postgresql://postgres.pobfpuohktigmnkcqwga:B94HRFut5WFr65Un@aws-1-us-east-2.pooler.supabase.com:5432/postgres' -c "select column_name from information_schema.columns where table_name='v_code_stories' order by ordinal_position desc limit 1" 2>&1
```

```output
 column_name 
-------------
 priority
(1 row)
```

```bash
grep -c 'priority' frontend/lib/database.types.ts
```

```output
8
```

8 occurrences of 'priority' in the regenerated types: code_items Row/Insert/Update, v_code_stories Row, and the swap_code_priority RPC args/returns. Types regenerated with supabase@2.95.0 via --db-url (Docker-backed, token-free).
