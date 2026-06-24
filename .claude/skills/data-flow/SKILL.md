---
name: data-flow
description: >
  Documents the frontend's data-flow and client-state architecture: database → API →
  context store → components on read, components → store action → API → database on write,
  the optimistic-store pattern with reconcile/rollback, the "fetch-all then filter
  client-side" choice, and when transient UI state belongs in a cross-row coordination
  store (ExpansionProvider / ActiveEditorProvider) vs a row's own useState. Use
  whenever you read, fetch, store, or mutate app data, or decide where state lives —
  "state management", "prop vs context", "coordination store", "optimistic
  update", "reconcile", "rollback", "router.refresh", "useTasks / useFolders".
  Pairs with the supabase, nextjs, and react skills.
---

# Data Flow & State Management (alfred frontend)

> Source: the alfred codebase — `frontend/lib/{data,stores,tree.ts,api-client.ts}`,
> `frontend/app/(tasks)/**`, `frontend/components/tasks/`. This is the project's intended
> architecture; keep it and this skill in sync when it changes.

## Mental Model

Data moves through four layers, the same way for every entity:

```
  READ                                            WRITE
  database                                        component event
    │  (supabase server client)                      │  store action
    ▼                                                 ▼
  lib/data/*  (server-only readers)               optimistic update to the store
    │  returns plain rows                            │  then await…
    ▼                                                 ▼
  Server Component  ── seeds (props) ──▶  CONTEXT STORE  ◀── reconcile / rollback
                                          │                    │  lib/api-client
                                          │ read hooks         ▼
                                          ▼                  route handler ─▶ database
                                       components            (app/api/**)
```

- **The database is the source of truth; the store is an optimistic client cache of it.**
- **Read:** a Server Component calls a `lib/data/*` reader and seeds the result into a
  Context store. Components read from the store via hooks — never fetch, never touch
  Supabase.
- **Write:** a component calls a **store action**. The action applies the change to the
  store immediately, calls `lib/api-client` (→ a route handler → the DB), then **reconciles**
  with the server response or **rolls back** on error. No `router.refresh()`.

The current entities are **folders** (`FoldersProvider`) and **tasks/items**
(`TasksProvider`) — but the layering is the rule; those are just the first two instances.
A new entity follows the same path: a `lib/data` reader, a Context store with optimistic
actions, `lib/api-client` wrappers, and route handlers.

## Where data lives: fetch-all, filter client-side

Both stores are mounted **once at the layout** (`app/(tasks)/layout.tsx`) and **seeded
once** from the server. The tasks store holds the **entire flat `Item[]`** (via
`getAllItems()`); each view (inbox / a folder / completed) is derived **client-side** by
filtering that list and building its tree — see `useScopedTasks(scope)` in
`tasks-store.tsx`, which does `buildTree(items.filter(predicateForScope))`.

This is a deliberate choice for a small, single-user dataset: **one fetch beats per-view
round-trips and per-navigation re-seeding**, and a single seed-once store sidesteps stale
re-seed bugs entirely. A single client view router (`TaskViews`) maps the URL to a `scope`
and renders the matching view from the store, so switching views (inbox / a folder /
completed) is a **client-side History-API URL change, not a per-view server render** — see
the nextjs skill, "Client-side view switching." **Revisit** (scoped/paginated server reads,
or a normalized cache) only when the dataset grows large enough that filtering everything in
memory hurts.

## Realtime: the code module's one push path

Seed-once works because the **only** writer is the user in their own browser — except in the
**code module**. A story's `factory_state` (its swimlane) is also written *out of band* by the
webhook Worker when a PR transitions, so `CodeProvider` subscribes to Supabase Realtime on the
base `code_items` table and applies each UPDATE through `codeItemToStoryPatch` → the reducer's
`patchStory`, moving the card to its new lane with no reload. **Subscribe to the base table, not
the `v_code_stories` view** — you can't subscribe to a view. `patchStory` is keyed by `item_id`
and a no-op when absent, so a change for an unknown/removed row is ignored; and an echo of the
user's own optimistic write re-applies identical values, so it's **idempotent** — no self-write
filtering. Tasks/Folders have a single browser writer and stay pure seed-once.

## Priority: the code module's one global ordering column (ALF-35)

The Backlog, the project board's epic order, and within-lane order all derive from **one**
`code_items.priority` column (a global rank across every project; lower = higher). Don't add a
second ordering source — the board *reflects* priority, it doesn't set it:

- **`useBacklog({ showCompleted })`** returns every story sorted by `priority` (outstanding-only
  unless `showCompleted`); **`useProjectBoard`** sorts each lane/escape bucket by `priority` and
  orders epics by their best (`min(priority)`) story (no-story epics last). All memoized like the
  other selectors.
- **`reorderStory(ref, neighbourRef)`** is the only writer: an optimistic **swap** — `patchStory`
  each of the two stories with the other's `priority` (capture the prior pair for rollback) →
  `api.reorderCode` → reconcile both returned rows via `codeItemToStoryPatch`. The **view** owns
  the filter/sort and picks the visible neighbour, so the action just swaps the pair it's handed.
  It's one `swap_code_priority` RPC (not two PATCHes), which swaps via a negative-sentinel
  sequence so the `unique(priority)` index never sees a transient duplicate — see the supabase
  skill (a one-statement CASE swap 409s under a non-deferrable unique index).
- `codeItemToStoryPatch` carries `priority`, so the realtime `code_items` path patches a
  cross-device reorder into an open tab for free (idempotent echo, as for `factory_state`).
- Reorder is a DOM sibling reorder, so it's animated with the FLIP `useFlipList` hook — motion skill.

## Transient UI state: local until a cross-row command needs it

Per-row UI state stays in the row's own `useState` — an input draft, the meta panel, the
title-edit text. It graduates to a tiny Context store **only** when an invariant or command
spans rows and so can't live in any single one. Two such coordination stores exist, both
mounted in the layout beside the data stores, both **seeded with no server data**, both
split into state + actions contexts (so actions-only callers don't re-render on every change):

- **`ActiveEditorProvider`** (`lib/stores/active-editor-store.tsx`) — only one inline input
  (a title edit **or** an add-subtask box) may be open across all rows. Rows derive their
  open flag from it (`sameEditor(active, { itemId, kind })`) and call `openEditor` /
  `closeEditor`; opening one closes whatever was open. `closeEditor` only clears when it
  still owns the slot, so a stale close (an async title save resolving *after* another input
  opened) no-ops instead of closing the new input.
- **`ExpansionProvider`** (`lib/stores/expansion-store.tsx`) — a row's two child-disclosure
  flags (its subtask tree and its "Show completed" panel) live here, not per-row, because a
  header **"collapse all"** must close every open row at once — a cross-row command no single
  row's state can express. Rows read `subtasks.has(id)` / `completed.has(id)` and call
  `toggleSubtasks` / `expandSubtasks` / `toggleCompleted`; `CollapseAllButton` dispatches
  `collapseAll(viewIds)` **scoped to its view**, so collapsing one view leaves others intact.
  Corollary: scope each action to what the store flag actually controls — an action that only
  opens the meta panel (editing a parent's due date/notes) must **not** also expand its
  subtree, since the panel renders as a sibling of the tree, not inside it.

Reach for a coordination store only for a genuine cross-row invariant or command — not to
hoist ordinary local state. **Consuming one needs no explanatory comment:** reading a store's
flags and calling its actions is the documented norm (this skill is its single source of
truth), so an inline note restating "expansion is a cross-row store, read from the provider"
is just noise — delete it. Comment only a genuinely non-obvious *local* decision, never the
pattern itself.

## Decision Tree

```
Read data in a component?            → a store read hook (useTasks/useScopedTasks/useFolders).
                                       Never fetch or create a supabase client in a component.
Read data in a Server Component?     → call a lib/data/* reader (server-only). Never inline supabase.from(...).
Mutate data?                         → call a store action (optimistic + reconcile). Never call api-client
                                       directly or router.refresh() after a mutation.
Derive a filtered view of a store?   → a selector hook (e.g. useScopedTasks) with useMemo. Don't refetch.
New read?                            → add a lib/data/* function; seed it into the store at the layout.
New write?                           → 1) route handler under app/api/**  2) lib/api-client wrapper
                                       3) optimistic store action (recipe below)  4) call it from the component.
Auth (login)?                        → the ONE exception: components/auth/login-form.tsx uses the browser
                                       supabase client directly.
```

## The Optimistic Mutation Recipe (reusable)

Every store action follows the same shape — use it for a new mutation **or when
refactoring a hard-refresh one**. Stores hold flat arrays; the pure helpers live in
`lib/tree.ts` (`buildTree`, `collectSubtree`, `makeOptimisticItem`). A small reducer
exposes five moves: `insert`, `replace` (swap one by id), `patch` (merge into a set of
ids — single edit or cascade), `upsert` (replace present + add missing), `remove`.

1. **Capture** the rows you're about to change for rollback — read the latest state from a
   ref (`tasksRef.current`). For a subtree op, `collectSubtree(items, rootId)` returns the
   affected rows.
2. **Apply the optimistic change** synchronously (`insert` a `makeOptimisticItem` placeholder
   / `patch` the ids / `remove` them).
3. `await` the **`lib/api-client`** call.
4. On success, **reconcile**: `upsert` the returned row(s) — swaps client values for
   server-canonical ones (and `replace` a temp id for the saved id on create).
5. On failure, **roll back**: `upsert` the captured rows (re-applies the originals, re-adding
   any that were removed), **fire an error toast** (below), and **re-throw** so the caller can
   still react (keep an edit form open, reset a draft).

Reference: `tasks-store.tsx` (`addTask`/`completeTask`/`updateTask`/`moveTask`/`deleteTask`)
and `folders-store.tsx`. Views update because the **selector filters the changed list** —
completing a task flips its `status`, so it drops out of the active views automatically.

The shared `runOptimisticMutation` helper (`lib/stores/optimistic-mutation.ts`) owns this
try/await/catch sequencing; an action passes `optimistic` / `apiCall` / `reconcile` /
`rollback` (and an optional `onError`) closures (omit `reconcile` for a delete — its rows are
already gone). The
**capture for rollback** stays the action's own, before the call, and picks the lightest of
three strategies for *what* it restores:

- **Full-row** (`upsert([prev])`) — the row touches many fields or is created/removed whole:
  capture the entire prior row(s) and re-apply them. Use for create (`remove` the temp on
  fail), complete/move/delete a subtree (`upsert` the captured `collectSubtree` rows), and a
  single multi-field edit (`updateTask`).
- **Selective-field** (`patch` the captured fields) — only one or two named fields change and
  the rest of the row may have moved on: capture just those fields and patch them back, so a
  stale rollback can't clobber an unrelated concurrent edit. Use for `code-store`'s
  `updateEpic` / `updateStoryTitle` / state transition.
- **Position-aware** (`insertAt(prev, index)`) — order matters and the op removes a row:
  capture the row **and its index**, and restore it at that slot, not appended. Use for
  `folders-store`'s `removeFolder`.

### Centralized error toast on rollback

A failed write must **tell the user it failed** — never snap back silently. So the rollback
path also fires **one error toast, from the store**, not from each component `catch`: pass
`runOptimisticMutation` an `onError: () => notifyError(message)` (it runs after `rollback`,
before the re-throw, and **only** for an API rejection — not a `reconcile` throw or a pre-call
guard throw). Manual `try/catch` actions (`code-store`'s `createProject`/`createEpic`) call it
in the `catch` after the rollback dispatch. Use a short, human-readable message
(`Couldn't save changes`) — **never `error.message`**, which leaks the HTTP status + response
body. The re-throw stays, so component-local UI reset (a title draft, `isConfirming`) is
unaffected. A client-only action with no API call (`tasks-store.removeGatedItem`) fires no
toast.

For this to work `ToastProvider` is mounted **above** the store providers — it is the
**outermost** provider in the shell layout (`app/(shell)/layout.tsx`), so the stores can reach
`useToastActions()`. **Stores sit above `ToastProvider` unless it's lifted**, so a store calling
it would otherwise throw "must be used within a ToastProvider". Each provider captures
`showToast` through an effect-synced ref (`showToastRef`, like `tasksRef`) so the stable (`[]`)
action closures can fire it without it becoming a memo dep.

### Non-negotiable invariants

- **Reconcile/patch is a no-op for ids not in the store** — the race rule: an out-of-order
  reconcile can't resurrect a row a later action removed. Roll back **per-id** (capture the
  affected rows), never with a whole-store snapshot.
- **Split state and actions into two contexts.** Actions are memoized (`useMemo([])`) and
  stable, so mutate-only components don't re-render when the data changes.
- **Read latest state for rollback via a `useEffect`-synced ref**, never a render-body write
  (`react-hooks/refs` forbids `ref.current = x` during render).
- **Seed once at the layout; no key, no prop-sync effect.** The provider is the session
  source of truth (single-user; a hard reload re-seeds). A prop-sync effect or a remount `key`
  would wipe optimistic state on navigation. (The code store additionally patches itself from
  `code_items` Realtime for out-of-band Worker writes, but it still seeds once — see "Realtime:
  the code module's one push path".)
- **Selector hooks memoize on the store + scope fields** (`useMemo([items, scopeType,
  folderId])`), and take a small, serializable scope (`TaskViews` builds it from the URL).

## Common Pitfalls (the anti-patterns this design removes)

- **Never create a supabase client in a component** (except auth in `login-form.tsx`).
- **Never inline `supabase.from('…')` in a Server Component** — add/clarify a `lib/data/*`
  reader.
- **Never call `lib/api-client` from a component or `router.refresh()` after a mutation** —
  route through a store action so the change is optimistic and reconciles locally. A
  `router.refresh()` in a mutation handler is a refactor target.
- **Never prop-drill entity lists or refetch per view.** Read the store and derive with a
  selector.
- **Never fake optimism with a local `dismissed`/`isPending` flag** to hide a row mid-flight
  — change the data; the filtered view updates, and a rollback brings it back.
- **Never `await` the mutation before closing a local edit UI.** An inline editor that
  replaces the displayed value (the title / due-date / notes input) must flip its
  editing flag off **synchronously, before** the `await` — otherwise the input hangs
  open for the whole round-trip and the optimistic value never shows through, so the edit
  looks non-optimistic. On failure, the store's rollback reverts the displayed value;
  don't keep the editor open to retry. (See `handleSaveTitle`/`handleSaveDueDate` in
  `task-row.tsx`.)
- **Never mirror store data in ad-hoc `useState`.** Local state is only for transient UI
  with no cross-row reach (an input draft, the meta panel) — a flag a header command must
  touch (row expansion) belongs in a coordination store, not per-row state.

## File Map

- `frontend/lib/data/{folders,items}.ts` — server-only readers (`getFolders`, `getAllItems`).
- `frontend/lib/stores/{folders-store,tasks-store}.tsx` — Context stores, optimistic actions,
  and selector hooks (`useScopedTasks`).
- `frontend/lib/stores/{active-editor-store,expansion-store}.tsx` — server-data-free cross-row
  coordination stores (which input is open; which rows are expanded). `CollapseAllButton` is
  the per-view collapse-all control that dispatches `collapseAll(viewIds)`.
- `frontend/lib/tree.ts` — pure helpers: `buildTree`, `collectSubtree`, `getDescendantIds`,
  `makeOptimisticItem`.
- `frontend/lib/api-client.ts` — typed `fetch` wrappers over the `app/api/**` route handlers.
- `frontend/app/api/**/route.ts` — the HTTP write boundary (auth + validation + Supabase).
- `frontend/app/(tasks)/layout.tsx` — fetches folders + all items once, mounts both stores.
- `frontend/app/(tasks)/{page,completed/page,folders/[id]/page}.tsx` — thin shells; each renders
  the `TaskViews` client view router (so a hard load / deep link resolves the right view).
- `frontend/components/tasks/{task-views,folder-view,completed-view}.tsx` — the URL→view router
  and the per-view components, all reading from the stores.
- `frontend/components/tasks/view-link.tsx` — `ViewLink`, the History-API anchor that switches
  views client-side (see the nextjs skill).
- `frontend/lib/test-utils.tsx` — `renderWithProviders({ folders, tasks })` for store-reading
  component tests.

## What's Deliberately Left Out

- **Realtime beyond the code module.** Only `code_items` is subscribed (the Worker is its second,
  non-browser writer — see "Realtime: the code module's one push path"). Tasks/Folders stay
  seed-once, and live cross-device INSERT/DELETE or `epics`/`projects` sync are not built.
- **A third-party state library (Zustand/Jotai/Redux/react-query) and a normalized cache.**
  Context + `useReducer` + flat arrays + `buildTree` cover the need with zero deps at this
  scale. `useSyncExternalStore` is the integration seam if an external store is ever adopted.
- **Mutations from Server Components (Server Actions).** Writes go through `lib/api-client` →
  route handlers so the same endpoints serve external ingress (e.g. Siri) and the client.
