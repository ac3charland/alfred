# ALF-43 — Display subtasks in chronological order

> **Status:** Implemented in this session (skip-refinement). Captures the agreed scope.
> **Module:** Tasks. Touches the tree-derivation helper `frontend/lib/tree.ts`.

## Context / problem

Items are stored flat (`Item[]` in the tasks store) and each view derives its forest for
rendering with `buildTree` (`frontend/lib/tree.ts`). `buildTree` sorted **every** level via
`sortForest` by `created_at` **descending** (newest first). For a parent's subtasks that reads
backwards: when you decompose a task into steps top-to-bottom, the most recently added subtask
floats to the top of the list instead of sitting at the bottom where you added it.

## Proposed change

Order **subtasks** chronologically (oldest → newest, `created_at` ascending) at **every depth**,
while **root tasks keep their newest-first ordering** (the capture-first inbox shows the latest
thing you captured at the top). The ticket names subtasks specifically; roots are deliberately
left newest-first.

- `sortForest` takes an `ascending` flag: `buildTree` sorts the **roots** descending
  (`ascending = false`), and every recursive call for a node's **children** passes
  `ascending = true`, so all subtasks sort chronologically regardless of depth.
- The sort stays **stable** for ties (two siblings sharing a `created_at` keep insertion order)
  in both directions — a strict comparison (`<` for roots, `>` for subtasks) never displaces an
  equal-timestamp earlier sibling.
- No schema, store, or API change: display order is governed solely by `sortForest`
  (`buildTree` re-sorts the seeded list on every render), so the server fetch order is
  irrelevant to what renders.

### Why not flip roots too

Flipping root order as well regressed an unrelated interaction E2E
(`e2e/task-row.spec.ts` "single active inline input across rows"): with two seeded root tasks,
reversing their order put the first-opened subtask box on the **top** row, so dismissing it on
mousedown collapsed that row and shifted the lower row's add-subtask button out from under the
click. Keeping roots newest-first avoids that and is faithful to the ticket's "subtasks" scope.

## Tests

- `frontend/lib/tree.test.ts` — root siblings sort descending; subtask siblings (and
  grandchildren) sort ascending; each direction stays stable on equal timestamps.

## Acceptance criteria

- [x] Subtasks render oldest → newest by `created_at` at every depth.
- [x] Root tasks remain newest-first.
- [x] Two siblings with the same `created_at` keep a stable (insertion) order.
- [x] `check` is green; the change is captured in a demo doc.

## Out of scope

- Reordering root tasks (left newest-first).
- A manual `position`/`sort_order` column for drag-reorder (still keyed off `created_at`;
  see the `dnd-kit` skill).
- The server-side fetch order in `lib/data/items.ts` — it is re-sorted client-side, so it is
  left untouched.
