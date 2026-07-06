# ALF-29 — Fix broken subtask creation for classified tasks

## Context / problem

Adding a subtask to a task is currently broken. When the user clicks **Add
subtask** on a task row and submits, the request fails and the network tab shows:

```
"new row for relation \"items\" violates check constraint \"items_task_only_fields\""
```

### Root cause

The DB constraint `items_task_only_fields`
(`database/migrations/0002_software_factory.sql`) enforces that a non-`task`
item cannot hold any task-lifecycle value — including a `parent_id`:

```sql
alter table items add constraint items_task_only_fields check (
  item_type = 'task'
  or (due_date is null and parent_id is null
      and status = 'active' and completed_at is null)
);
```

So any row with a non-null `parent_id` **must** have `item_type = 'task'`. This
matches the product spec: *"any subtask is itself a full task"*
(`docs/specs/product/SPEC.md`, §Tasks).

But subtask creation never sets that type. The store action `addTask`
(`frontend/lib/stores/tasks-store.tsx`) hardcodes `item_type: 'unclassified'`
for every created item, even when a `parentId` is supplied:

```ts
const createInput: api.CreateItemInput = {
  text: input.text,
  raw_capture: input.text,
  item_type: 'unclassified',
  ...(parentId !== undefined && { parent_id: parentId }),
};
```

The API route `POST /api/items` (`frontend/app/api/items/route.ts`) likewise
defaults `item_type` to `'unclassified'` when none is provided. So the insert is
`{ item_type: 'unclassified', parent_id: <task> }`, which violates the
constraint and 500s.

The **Add subtask** affordance only renders on `task` rows
(`frontend/components/tasks/task-row.tsx` — *"subtasks nest only under tasks"*),
so the parent is always a classified task; the failure is on the **child** row's
type, not the parent's. The ticket title ("for classified tasks") reflects that
the user observes this when adding a subtask under a classified task — which is
the only place the affordance appears, so subtask creation is broken in all cases.

## Proposed change

A subtask is, by the product model and the DB constraint, always a `task`.
Make subtask creation create the child as a `task` instead of `unclassified`.

1. **Store (`frontend/lib/stores/tasks-store.tsx`, `addTask`)** — when a
   `parentId` is present, set `item_type: 'task'` on the create input (and
   therefore on the optimistic row), instead of the unconditional
   `'unclassified'`. Top-level captures (no `parentId`) keep `'unclassified'` —
   capture-first triage is unchanged. Setting the correct type on the optimistic
   item also keeps the optimistically-rendered row consistent (it is a task row,
   with task affordances) before the server reconciles.

2. **API route (`frontend/app/api/items/route.ts`, `POST /api/items`)** —
   defense in depth so the invariant holds regardless of caller: when the
   request supplies a `parent_id`, the inserted row must be `item_type = 'task'`.
   Coerce to `'task'` when `parent_id` is present (rather than letting it default
   to `'unclassified'`). A root capture with no `parent_id` still defaults to
   `'unclassified'`. This guarantees the constraint can never be hit again from
   this endpoint even if a future caller omits `item_type`.

No schema change. The `items_task_only_fields` constraint is correct and stays as
the backstop; this ticket fixes the write paths that were producing illegal rows.

## Acceptance criteria

- [ ] Clicking **Add subtask** on a task row, entering text, and submitting
      creates the subtask successfully — no constraint violation, no 500.
- [ ] The created subtask row has `item_type = 'task'` and the correct
      `parent_id` pointing at its parent task.
- [ ] Top-level capture (the capture box / `addTask` with no `parentId`) is
      unchanged: the new item is still created as `item_type = 'unclassified'`.
- [ ] `POST /api/items` with a `parent_id` and no `item_type` (or any caller
      that would previously have inserted `unclassified` + `parent_id`) inserts
      the row as `item_type = 'task'`, never violating `items_task_only_fields`.
- [ ] The optimistic row shown before the server responds is a `task` row (not an
      unclassified row), so it does not flicker an inbox/classify affordance.
- [ ] Tests express the new behavior (Red/Green TDD; failing first):
  - [ ] Store unit test (`frontend/lib/stores/tasks-store.test.tsx`): `addTask`
        with a `parentId` produces a create input / optimistic item with
        `item_type: 'task'`; without a `parentId` it stays `'unclassified'`.
  - [ ] API route test (`frontend/app/api/items/route.test.ts`): a POST with a
        `parent_id` inserts `item_type: 'task'`; a POST without `parent_id` still
        inserts `'unclassified'`.
  - [ ] An e2e (`frontend/e2e/`) covering: add a subtask under an existing task
        and assert it appears in the tree (the end-to-end path that currently
        500s).
- [ ] `npm run check` is green.
- [ ] A demo doc at `docs/demos/<branch>/…` reproduces adding a subtask to a
      classified task (the showboat flow), since this is a user-facing behavioral
      change.

## Out of scope / open questions

- No change to the `items_task_only_fields` constraint or any other schema — the
  constraint is correct; only the write paths are fixed.
- No change to top-level capture or to the inbox classification flow
  (`classifyItem`) — those remain `unclassified`-first by design.
- No change to drag-to-reparent (`reparentTask`) or promote-to-root, which move
  existing `task` rows and already keep `item_type = 'task'`.
- Backfill of any pre-existing malformed rows is not needed: the constraint
  prevented illegal rows from ever being written, so none exist.
