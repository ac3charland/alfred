---
branch: claude/code-items-dispatch-bug-5pysag
---

# The Backlog rank respaces itself when it runs out of float

*2026-09-03T18:39:29.794Z*

Every code dispatch lands at the MIDPOINT of two Backlog ranks, so each dispatch halves the gap it lands in. `code_items.priority` is `double precision`, so after roughly fifty halvings the two bounding ranks are adjacent doubles and the midpoint rounds onto one of them. The unique index rejects it and PostgREST answers 409 — permanently, since the failed transaction rolls back and the next attempt recomputes the same collision.

This is what production hit. The Alfred project's two bounding ranks had converged on `-158.999999014483`, and every code dispatch answered 409 while task dispatch (a plain `dispatched_at` PATCH, which never touches this column) kept working. The Postgres log behind each 409 read: `duplicate key value violates unique constraint "code_items_priority_key"`.

The script below stands up a throwaway Postgres twice — once with the migrations as they stood before this branch, once with 0031 — seeds the identical exhausted state, and runs the dispatch a browser makes.

```bash
node docs/demos/code-priority-respacing/reproduce.mjs
```

```output

── migrations 0001–0030 (production, before this branch) ──
  seeded GAP-1 at 20000
  seeded RAN-1 at 20000.000000000004
  midpoint of the two = 20000 → collides: true
  dispatch → 23505 duplicate key value violates unique constraint "code_items_priority_key"

── every migration, 0031 included ──
  seeded GAP-1 at 20000
  seeded RAN-1 at 20000.000000000004
  midpoint of the two = 20000 → collides: true
  dispatch → OK, RAN-2 landed at 1.5
  Backlog now: GAP-1=1  RAN-2=1.5  RAN-1=2
```

Respacing is a renumbering, never a reordering: `GAP-1` and `RAN-1` come back as 1 and 2 in the order they already stood, and the new story slots between them at 1.5 — where before there was nowhere to put it. The guard also covers the double-chevron reorder (`move_code_priority_in_project`), which midpoints against the same two bounds.

The unique index is not the bug, it is the smoke alarm — without it the collision would have put two stories on one rank and ordered the Backlog arbitrarily, which is far harder to notice than a 409. It stays, as a deferrable constraint so the respace can rewrite every rank in one statement.
