---
name: dnd-kit
description: >
  Covers dnd-kit drag-and-drop in alfred's frontend: the stable @dnd-kit/core + @dnd-kit/sortable
  line (DndContext, useSortable, SortableContext, useDroppable, sensors, collision detection,
  DragOverlay) and how it wires into the existing optimistic task/folder stores. Use when adding
  or debugging any drag interaction — reorder tasks in a list, drag a task into a sidebar folder,
  re-nest a subtask, add a drag handle, keyboard-accessible DnD, or persist a manual order — or on
  any import from @dnd-kit/*. Trigger on: "drag and drop", "drag-and-drop", "reorder", "sortable",
  "dnd-kit", "useSortable", "DndContext", "DragOverlay", "drag to folder", "drag handle",
  "arrayMove", or "sortable tree". Pairs with the data-flow skill (optimistic moveTask/reorder
  actions), the motion skill (reduced-motion), the react skill (hooks), and the
  playwright/storybook skills (testing drags). Note: the newer @dnd-kit/react rewrite is a
  separate, pre-1.0 package alfred does NOT use.
---

# dnd-kit Skill — alfred project

> alfred uses the **stable** dnd-kit line (`@dnd-kit/core`, `@dnd-kit/sortable`,
> `@dnd-kit/utilities`, `@dnd-kit/modifiers`). **Not** the ground-up rewrite published as
> `@dnd-kit/react` (still 0.x). See **Version Gotchas** — getting these crossed is the #1 way
> to waste an hour here. dnd-kit is **not installed yet**; add it with
> `npm i @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities @dnd-kit/modifiers -w frontend`.

---

## Mental Model

dnd-kit is **headless**: it tracks "what is being dragged" and "what it's over", fires
callbacks, and hands you `transform` values — **it never moves your data or renders a moved
item for you.** You own the DOM, the styles, and the state change. A drag is a transient UI
gesture; the *result* is a normal optimistic store mutation (see the data-flow skill).

Three nested pieces:

```
<DndContext>                      ← one per draggable region. Owns sensors, collision
                                    detection, and the onDrag* callbacks. The drop happens here.
  <SortableContext items={ids}>   ← a sortable LIST. `items` is the ordered array of ids;
                                    it must match the rendered order exactly.
    useSortable({ id })           ← one hook per row. Returns refs/listeners/transform.
  </SortableContext>
  <DragOverlay>…</DragOverlay>    ← optional floating clone of the dragged item.
</DndContext>
```

- `useSortable` is `useDraggable` **and** `useDroppable` fused — every sortable item is both a
  drag source and a drop target, which is what makes reordering work.
- `useDroppable` alone = a **non-sortable drop zone** (alfred's sidebar folders: you drop *onto*
  a folder, you don't reorder folders).
- **The id is everything.** Every draggable/droppable needs a stable, unique `id`. Use the
  item's real `id`. dnd-kit reports drags purely as `active.id` / `over.id` — you map those back
  to your data.

---

## Packages & what each is for

| Package | You import | For |
|---|---|---|
| `@dnd-kit/core` | `DndContext`, `DragOverlay`, `useDraggable`, `useDroppable`, sensors, collision fns | the engine + non-sortable drops |
| `@dnd-kit/sortable` | `SortableContext`, `useSortable`, `arrayMove`, `sortableKeyboardCoordinates`, `*SortingStrategy` | reorderable lists |
| `@dnd-kit/utilities` | `CSS` (`CSS.Transform.toString`) | turn the `transform` object into a CSS string |
| `@dnd-kit/modifiers` | `restrictToVerticalAxis`, `restrictToWindowEdges`, `restrictToParentElement` | constrain motion |

---

## Decision Tree

```
Reordering items WITHIN one flat list (drag row 2 above row 5)?
  → SortableContext + useSortable. Persist with a reorder store action (needs an order column).

Dropping an item ONTO a fixed target that isn't itself reorderable (a sidebar folder, Inbox)?
  → useDroppable on each target + useDraggable on the row. On drop, call moveTask(id, folderId).
    (No SortableContext — folders aren't a sorted list.)

Moving an item across containers AND reordering (Trello columns)?
  → Multiple SortableContexts inside ONE DndContext; reconcile in onDragOver/onDragEnd.

Nested / arbitrary-depth tree with re-parenting (alfred subtasks)?
  → The hard case. A flat SortableContext can't express depth. Use the projection approach
    (compute target depth+parent from pointer x-offset; forbid dropping a node into its own
    descendant). See "Nested subtasks" below — phase it AFTER flat reorder + drag-to-folder.

Which collision algorithm?
  → Vertical/horizontal sortable LIST → closestCenter (forgiving, the default choice).
  → Dropping a small item onto large zones (folders) → pointerWithin or rectIntersection.
  → rectIntersection alone on a list feels "sticky" — both rects must overlap. Avoid for lists.

Do I need a DragOverlay?
  → Yes if the list scrolls or is taller than the viewport, or you want the dragged item to
    visually detach (lift/shadow). Otherwise the in-place transform is fine.
```

---

## Plain-English → Pattern Table

| When you need to… | Pattern | Key things to know |
|---|---|---|
| **Make a list reorderable** | Wrap rows in `<SortableContext items={ids} strategy={verticalListSortingStrategy}>`; call `useSortable({ id })` in each row | `items` must be the **ordered id array** matching render order. |
| **Apply the drag transform to a row** | `style={{ transform: CSS.Transform.toString(transform), transition }}` + spread `{...attributes} {...listeners}` on the row (or the handle) | `transform`/`transition` come from `useSortable`. Use `CSS.Transform.toString`, not manual string building. |
| **Compute the new order on drop** | `onDragEnd={({active, over}) => { if (over && active.id !== over.id) setOrder(arrayMove(ids, oldIndex, newIndex)) }}` | `arrayMove(array, from, to)` returns a new array. Persist it (see alfred wiring). |
| **Drag a task into a sidebar folder** | `useDroppable({ id: folder.id })` on each `ViewLink`; `useDraggable({ id: item.id })` on the row; `onDragEnd` → `moveTask(active.id, over?.id ?? null)` | **`moveTask` already exists** — drag-to-folder needs no new store action. Drop on an Inbox droppable → `moveTask(id, null)`. |
| **Add a dedicated drag handle** so row buttons still click | Spread `{...listeners} {...attributes}` on the handle element and bind it with `setActivatorNodeRef`; keep `setNodeRef` on the row | Without a handle, listeners on the whole row swallow clicks on the rename/delete/expand `IconButton`s. |
| **Stop a drag from hijacking a click** | `useSensor(PointerSensor, { activationConstraint: { distance: 8 } })` | Requires an 8px move before a drag starts, so taps still register as clicks. |
| **Make it keyboard-accessible** | `useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })` | Tab to the handle, Space to lift, Arrows to move, Space to drop, Esc to cancel. This is also what makes drags **testable** (see Testing). |
| **Float a clone while dragging** | `<DragOverlay>{activeId ? <RowPresentation …/> : null}</DragOverlay>`; track `activeId` from `onDragStart`/`onDragEnd` | Render a **presentational** row here, never the `useSortable` one — see Pitfalls (id collision). |
| **Constrain to vertical / within parent** | `modifiers={[restrictToVerticalAxis, restrictToParentElement]}` on `DndContext` | Import from `@dnd-kit/modifiers`. |

---

## Callback / Lifecycle Guarantees

`DndContext` fires, in order, per drag: `onDragStart` → `onDragMove`* → `onDragOver`* →
(`onDragEnd` **or** `onDragCancel`). Exactly one of End/Cancel always fires — pair any
start-state you set with a reset in **both**.

- `onDragStart({ active })` — `active.id` is the picked-up id. Set `activeId` here for the overlay.
- `onDragOver({ active, over })` — `over` is the current drop target or **`null`** (dragged off
  any target). For cross-container moves, reconcile container membership here.
- `onDragEnd({ active, over })` — the commit point. `over` is `null` if dropped on nothing.
  **Always** `if (!over) return;` then `if (active.id !== over.id)` before mutating. Reset `activeId`.
- `onDragCancel` — Esc or programmatic abort. Reset the same transient state as `onDragEnd`.

`active.id` and `over.id` are `UniqueIdentifier` (`string | number`); alfred ids are strings.

---

## Wiring into alfred (the part that makes this a skill, not a doc)

**Drag-to-folder is nearly free.** The tasks store already exposes
`moveTask(id, folderId: string | null)` (optimistic patch of the subtree's `folder_id`, with
reconcile/rollback — see data-flow skill). So the *only* new code is the DnD plumbing: a
`DndContext` around the `(tasks)` layout, `useDroppable` on each folder `ViewLink` + an Inbox
drop zone, `useDraggable` on `TaskRow`, and `onDragEnd → moveTask(active.id, over?.id ?? null)`.
Re-parenting a subtask is the same idea against `parent_id` (a `reparentTask` action you'd add
following the optimistic recipe).

**Reorder is NOT free — there is no order column yet.** `items` has `created_at` but no
`position`/`sort_order`, and `buildTree`'s `sortForest` orders the forest by **`created_at`
descending**. A manual drag-reorder therefore has nothing to persist to and nothing to sort by.
To support it you must, as one deliberate task: (1) add an ordering column to `items`
(migration in `database/`) — prefer a **fractional rank** (e.g. a `numeric`/string key set to
the midpoint between neighbours) so one move is **one** row UPDATE, not a renumber of the list;
(2) change `sortForest` to order by it; (3) add a `reorderTask` store action + an
`/api/items/:id` PATCH; (4) call it from `onDragEnd` with `arrayMove` to compute the local order.
Treat reorder as a follow-up to drag-to-folder, not a prerequisite.

**Never drag an unreconciled item.** A just-captured task carries a `temp-…` id
(`isTempId`, `lib/tree.ts`) until the server reconciles it. PATCHing a temp id 404s. Set
`useSortable({ id, disabled: isTempId(id) })` so optimistic placeholders aren't draggable.

**Everything is `'use client'`.** dnd-kit reads layout (`getBoundingClientRect`) and only runs in
the browser. The `(tasks)` components are already client components; keep the `DndContext` inside
one. There is no SSR concern as long as it lives under `'use client'`.

**Respect reduced motion** (SPEC §5.4, motion skill). The `transition` string from `useSortable`
animates the reorder settle. Drop it under reduced motion:
`const reduce = usePrefersReducedMotion(); style={{ …, transition: reduce ? undefined : transition }}`.

---

## Accessibility

dnd-kit ships **screen-reader announcements by default** (it injects an `aria-live` region
narrating pick-up/move/drop/cancel) and a `KeyboardSensor` — together they cover SPEC §5.4's
keyboard-focus + a11y floor with almost no work. To get them you must:

- Add the `KeyboardSensor` with `sortableKeyboardCoordinates` (table above). Without it, the
  list is mouse-only and fails the a11y floor.
- Spread `{...attributes}` onto the draggable/handle — it carries `role`, `tabIndex`,
  `aria-roledescription`, and `aria-describedby` wiring. Dropping it silently breaks keyboard DnD.
- Customise wording via `DndContext`'s `accessibility={{ announcements, screenReaderInstructions }}`
  only if the defaults read poorly for tasks; otherwise leave them.

---

## Common Pitfalls

- **Never `disabled` a *droppable* you only want to reject a drop on.** A disabled droppable
  leaves collision detection entirely, so releasing the pointer on it makes dnd-kit report the
  **previously-hovered** droppable as `over` — a silent drop onto the wrong target (this is how
  "drop a task back on itself after hovering another → it vanishes under that other task"
  happened). Keep every row a *registered* droppable and decide validity in `onDragEnd`
  (skip self/descendant/completed/temp there), gating only the **highlight** on validity. Also
  guard the mutation against cycles at the store (`reparentTask` no-ops a self/descendant
  target) so a stale `over` can never corrupt the tree. (Disabling a *draggable* — e.g.
  `useSortable({ disabled: isTempId })` — is fine; this is only about droppables.)
- **Drop zones that bracket a list must not reflow it mid-drag.** A zone that grows from 0
  height on drag-start shoves the rows (and the targets you're aiming at) down under the
  cursor. Reserve the **top** zone's height at all times (invisible until needed); let the
  **bottom** zone grow into the empty space below the list, which moves nothing.
- **Never render the `useSortable` component inside `<DragOverlay>`.** Two mounts share one id →
  `useDraggable` id collision → glitchy drags. Split into a **presentational** row (pure props,
  no hook) rendered in the overlay, and a sortable wrapper that renders the presentational one.
- **`SortableContext items` must exactly match the rendered order and use the same ids** you pass
  to `useSortable`. A mismatch makes items jump to wrong slots or refuse to sort.
- **Listeners on the whole row eat button clicks AND keystrokes.** alfred drags from the whole
  row (no handle), so it guards BOTH sensors against the row's controls via `isInteractiveTarget`
  (`lib/dnd/pointer-sensor.ts`): `RowPointerSensor` for press, `RowKeyboardSensor` for keys.
  Without the keyboard guard, the `KeyboardSensor` lifts on **Space/Enter** (its default start
  codes) when a keydown bubbles up from a focused control inside the row — so pressing space in
  the inline title `<input>` started a phantom drag and `preventDefault`-ate the typed space,
  collapsing the editor. Both custom sensors omit the `activatorNode` check (alfred sets no
  `setActivatorNodeRef`), so the interactive guard is the only thing standing between a control
  and an accidental lift; any new draggable-row controls inherit the protection for free.
- **No `activationConstraint` → every click starts a drag** and taps stop working. Always set
  `{ distance: 8 }` (or `{ delay, tolerance }` for touch) on the `PointerSensor`.
- **`rectIntersection` on a vertical list feels broken** (must fully overlap). Use `closestCenter`
  for lists; reserve `rectIntersection`/`pointerWithin` for dropping onto large zones (folders).
- **Forgetting `if (!over) return;` in `onDragEnd`** throws when the user drops on empty space.
- **Build the transform with `CSS.Transform.toString(transform)`**, not a hand-written
  `translate3d` — dnd-kit's util handles scale/SSR-safety. Import `CSS` from `@dnd-kit/utilities`.
- **Don't mutate `arrayMove`'s input** — it returns a new array; set state with the return value.

---

## Version Gotchas

There are **two dnd-kits**, and search results / training data blend them:

- **Stable (what alfred uses):** `@dnd-kit/core` + `@dnd-kit/sortable` + `@dnd-kit/utilities` +
  `@dnd-kit/modifiers`. Hooks API: `DndContext`, `useSortable`, `SortableContext`, sensors. Mature
  (core v6+), battle-tested, React 19-compatible. Its docs are now labelled **"Legacy"** at
  **docs.dndkit.com** / `dndkit.com/legacy` — *legacy* here means "previous architecture", **not**
  deprecated/unmaintained.
- **The rewrite (alfred does NOT use):** a single `@dnd-kit/react` package (built on
  `@dnd-kit/dom` / `@dnd-kit/abstract`), still **pre-1.0** (0.x). Different API —
  `DragDropProvider`, a redesigned `useSortable`. Its docs are the **default** site at
  **dndkit.com/react**. Do not mix the two; an import from `@dnd-kit/react` is the tell that
  you've drifted onto the wrong line. Revisit it only when it ships a stable 1.0.

If you copy an example, confirm the import paths are the stable packages above.

---

## Testing dnd-kit under alfred's gates

Drag behaviour is verified in the **slow tier** (Storybook test-runner + Playwright, real
Chromium), not unit tests:

- **jsdom can't measure layout** — `getBoundingClientRect` returns all-zeros, so dnd-kit's
  collision detection can't tell where anything is. RTL/Jest drag simulations are unreliable;
  **don't** assert reorder outcomes there. Instead **unit-test the pure logic** (the `arrayMove`
  call, the fractional-rank calc, the "is this a descendant?" guard) extracted into plain
  functions — fast, deterministic, and where the real bugs live.
- **Sortable lists → keyboard sensor in E2E** (deterministic): focus the handle, `Space` to lift,
  `Arrow` keys to move, `Space` to drop. **Spatial drops onto fixed targets (drag-to-folder) →
  pointer drag**, since there's no sortable axis to arrow along. Reliable Playwright recipe:
  `mouse.move` to the handle centre → `mouse.down` → `mouse.move` ~16px (clear the 8px activation
  distance) → `mouse.move` to the target centre `{ steps: 10 }` → `mouse.up`. Wait on a visible
  drop-state marker (e.g. a `data-drop-over` attr the droppable sets when `isOver`) before
  asserting or screenshotting. A throwaway demo-capture spec must be named `*.spec.ts` to match
  Playwright's `testMatch`.
- **A drag fired right after `goto` races hydration under load** (e.g. inside the pre-push
  `check:slow`, which runs the prod build): if React's handlers aren't attached yet, the
  press+move is a **text selection**, not a drag, and silently does nothing. Drags that first
  click something (expand a row) are fine; a bare drag-after-navigation isn't. Make a shared
  `pickUp` helper that **retries the press until the row enters its dragging state** (the
  `opacity-40` it gets while dragged) before gliding to the target.
- **The `DragOverlay` clones the dragged item's text**, so `getByText(title)` matches **two**
  nodes mid-drag (the row + the floating clone). Capture any bounding boxes you need *before*
  pressing, or scope past the overlay.
- **A re-parent's optimistic→reconcile re-render can swallow a click** that lands in the same
  tick under load. Wrap a post-drop interaction (e.g. expanding the new parent) in
  `expect(async () => …).toPass()`, clicking only while still collapsed so it never toggles
  back shut.
- Capture the working interaction as a **demo doc** (showboat skill) once green — for this visual
  change the evidence is screenshots (inbox handle → mid-drag overlay+highlight → filed), driven
  through the Playwright mock backend; never test-suite output.

---

## What Was Deliberately Left Out

- **The `@dnd-kit/react` rewrite API.** Covered only as the thing to avoid (Version Gotchas).
- **A full nested sortable-tree implementation.** The official tree example
  (`stories/3 - Examples/Tree/SortableTree.tsx` in clauderic/dnd-kit) and the third-party
  `dnd-kit-sortable-tree` wrapper exist; the projection/depth logic is non-trivial and known to
  have perf caveats on large trees. Document the concrete approach here when alfred actually
  builds arbitrary-depth re-nesting (phase it after flat reorder + drag-to-folder).
- **Virtualized lists, 2D grids, multi-axis games.** dnd-kit supports them; alfred's scale
  (hundreds of items, single user) doesn't need them.
- **`@dnd-kit/modifiers` beyond the axis/edge restrictors** and custom collision algorithms — add
  here if a real need arises.

> Source: dnd-kit legacy docs (docs.dndkit.com — DndContext, Sortable preset, collision-detection,
> accessibility) and the clauderic/dnd-kit repo, cross-referenced with alfred's
> `lib/stores/tasks-store.tsx`, `lib/tree.ts`, and `database/migrations/0001_initial_schema.sql`.
