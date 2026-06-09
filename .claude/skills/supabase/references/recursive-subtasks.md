# Recursive Subtasks — WITH RECURSIVE CTE Patterns

> Source: PostgreSQL documentation §7.8 "WITH Queries (Common Table Expressions)"
> (postgresql.org/docs/current/queries-with.html)
> Source: "Beyond Flat Tables: Model Hierarchical Data in Supabase with Recursive Queries"
> (dev.to/roel_peters_8b77a70a08fdb, confirmed June 2026)

## Schema recap (alfred)

```sql
-- items table (relevant columns)
id          uuid primary key default gen_random_uuid(),
title       text not null,
parent_id   uuid references items(id) null,  -- null = top-level task
folder_id   uuid references folders(id) null, -- null = Inbox
status      item_status not null default 'active',
```

## Why PostgREST alone can't do this

PostgREST translates the supabase-js fluent API to SQL `SELECT` statements. It has no syntax for `WITH RECURSIVE`. The only way to execute a recursive CTE from the JS client is to wrap it in a **Postgres function** and call it with `supabase.rpc()`.

## Create the Postgres function (migration SQL)

```sql
-- database/migrations/YYYYMMDDHHMMSS_subtree_function.sql

CREATE OR REPLACE FUNCTION get_subtree(root_id uuid)
RETURNS SETOF items
LANGUAGE sql
STABLE
SECURITY INVOKER  -- respects RLS of the calling user
AS $$
  WITH RECURSIVE subtree AS (
    -- Anchor: the root task itself
    SELECT *
    FROM items
    WHERE id = root_id

    UNION ALL

    -- Recursive step: children of each row already in the CTE
    SELECT i.*
    FROM items i
    INNER JOIN subtree s ON i.parent_id = s.id
  )
  SELECT * FROM subtree;
$$;
```

**Notes:**
- `SECURITY INVOKER` means the function runs with the permissions of the calling role. RLS policies on `items` are still enforced. Use `SECURITY DEFINER` only if you explicitly want to bypass RLS (rare, and requires careful thought about what you're exposing).
- `STABLE` tells Postgres the function doesn't modify the database and returns the same results for the same arguments within a single transaction — this enables query plan caching.
- Add a depth guard if you want to protect against runaway recursion on corrupted data: replace the recursive step with a depth counter and add `WHERE s.depth < 50`.

## Depth-guarded version (recommended for production)

```sql
CREATE OR REPLACE FUNCTION get_subtree(root_id uuid)
RETURNS TABLE (
  id uuid, title text, notes text, source_url text,
  item_type item_type, created_at timestamptz,
  raw_capture text, due_date timestamptz,
  status item_status, completed_at timestamptz,
  folder_id uuid, parent_id uuid, depth int
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH RECURSIVE subtree AS (
    SELECT *, 0 AS depth
    FROM items
    WHERE id = root_id

    UNION ALL

    SELECT i.*, s.depth + 1
    FROM items i
    INNER JOIN subtree s ON i.parent_id = s.id
    WHERE s.depth < 50  -- guard against cycles
  )
  SELECT * FROM subtree ORDER BY depth, created_at;
$$;
```

## Calling from supabase-js

```typescript
const { data: tree, error } = await supabase.rpc('get_subtree', {
  root_id: taskId,
})
// tree is Items[] (all descendants including the root), sorted depth-first
```

To type the result, add `Database` generic to your client and the return type will be inferred as `Tables<'items'>[]`.

## Building the tree in JS (after fetching flat list)

The RPC returns a flat array ordered by depth. To render a nested tree:

```typescript
type ItemWithChildren = Tables<'items'> & { children: ItemWithChildren[] }

function buildTree(flat: Tables<'items'>[]): ItemWithChildren[] {
  const map = new Map<string, ItemWithChildren>()
  const roots: ItemWithChildren[] = []

  for (const item of flat) {
    map.set(item.id, { ...item, children: [] })
  }
  for (const item of flat) {
    const node = map.get(item.id)!
    if (item.parent_id && map.has(item.parent_id)) {
      map.get(item.parent_id)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}
```

The first element in `flat` is always the root (depth 0) because of the `ORDER BY depth` in the SQL.

## Cascade-completing all subtasks

To mark a task and all its descendants as completed in one query, use a similar CTE inside an UPDATE:

```sql
CREATE OR REPLACE FUNCTION complete_subtree(root_id uuid)
RETURNS SETOF items
LANGUAGE sql
SECURITY INVOKER
AS $$
  WITH RECURSIVE subtree AS (
    SELECT id FROM items WHERE id = root_id
    UNION ALL
    SELECT i.id FROM items i
    INNER JOIN subtree s ON i.parent_id = s.id
  )
  UPDATE items
  SET status = 'completed', completed_at = now()
  WHERE id IN (SELECT id FROM subtree)
  RETURNING *;
$$;
```

Call from JS: `await supabase.rpc('complete_subtree', { root_id: taskId })`
