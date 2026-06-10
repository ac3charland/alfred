---
name: data-flow
description: >
  Use whenever you read, fetch, store, or mutate app data in the alfred frontend —
  folders, tasks/items, or any future entity — or decide where data should live.
  Covers the layered data flow (server-only lib/data read layer → Server Components →
  Context stores → lib/api-client → route handlers), the optimistic-store pattern with
  reconcile/rollback, and the anti-patterns this architecture exists to prevent. Trigger
  on: "fetch data", "state management", "where should this data live", "prop vs context",
  "add a query / endpoint", "optimistic update", "reconcile", "rollback", "router.refresh",
  "create a supabase client", "useFolders / useTasks", "FoldersProvider / TasksProvider",
  "lib/data", or refactoring a hard-refresh mutation. Pairs with the supabase skill
  (client creation / queries), the nextjs skill (Server vs Client boundary), and the
  react skill (context + hooks).
---

# Data Flow & State Management (alfred frontend)

> Source: the alfred codebase itself — `frontend/lib/{data,stores,tree.ts,api-client.ts}`,
> `frontend/app/(tasks)/**`, and the components under `frontend/components/tasks/`. This is
> the project's intended architecture; keep it and this skill in sync when it changes.

## Mental Model

**The database is the source of truth. The client holds an _optimistic session cache_ of
it.** Data flows in one direction on read and a tight loop on write:

```
                 READ (server)                         WRITE (client)
  Supabase ─▶ lib/data/* ─▶ Server Component ─┐   store action ─▶ lib/api-client ─▶ route handler ─▶ Supabase
 (server client)  (server-only)    │ seeds    │        │ optimistic            (server client)
                                    ▼          │        ▼ reconcile / rollback
                          FoldersProvider / TasksProvider  (Context store)
                                    │ useFolders() / useTasks() (read)
                                    │ useFolderActions() / useTaskActions() (mutate)
                                    ▼
                          components (FolderNav, TaskList, TaskRow, CaptureBox)
```

Two stores, because the data has two scopes:

- **`FoldersProvider`** — folders are global across the `(tasks)` group, so it lives in
  `app/(tasks)/layout.tsx`, wrapping the whole layout body, **seeded once** from
  `getFolders()`. It is the session source of truth for folders (single-user, no realtime;
  a hard reload re-seeds).
- **`TasksProvider`** — the task forest is per-route, so it lives in **each page**, seeded
  from that page's tree (`getInboxTree()` / `getFolderItems(id)` / `getCompletedItems()`).

Every mutation is **optimistic**: apply the predicted change to the store instantly, call
`lib/api-client`, then **reconcile** with the returned row(s) on success or **roll back** on
failure. There is no `router.refresh()` in the mutation path.

## Decision Tree

```
Need to READ data in a component?
  → useFolders() / useTasks(). Never fetch in a client component, never create a supabase client.

Need to READ data in a Server Component (page/layout)?
  → call a function in lib/data/* (getFolders, getInboxTree, getFolderItems, getCompletedItems, getFolder).
    Never inline supabase.from('...') in a page/layout.

Need to MUTATE data?
  → call a store action (useFolderActions / useTaskActions). It is optimistic + reconciles.
    Never call lib/api-client directly from a component, and never follow a mutation with router.refresh().

Need a NEW read?
  → add a function to lib/data/* (server-only) and call it from the Server Component.

Need a NEW write?
  → 1. add/extend a route handler under app/api/**   2. add a typed wrapper in lib/api-client.ts
    3. add a store action that applies it optimistically (see the recipe below)   4. call the action from the component.

Auth (login / signInWithPassword)?
  → the ONE allowed exception: components/auth/login-form.tsx uses the browser supabase client directly.
```

## Plain-English → Pattern Table

| When you need to… | Do this | Not this |
|---|---|---|
| show the folder list anywhere | `const folders = useFolders()` | a `folders` prop drilled through the tree |
| show the task tree on a route | wrap the page in `<TasksProvider initialTasks={tree}>`, render `<TaskList />` (reads `useTasks()`) | pass `nodes` down through props |
| add a task / subtask | `useTaskActions().addTask({ text, folderId?, parentId? })` | `createItem()` + `router.refresh()` |
| complete / delete / move a task | `completeTask(id)` / `deleteTask(id)` / `moveTask(id, folderId\|null)` | `completeTask()` + `router.refresh()` + a local `dismissed` flag |
| edit a task field (title/due/notes) | `updateTask(id, { title }\|{ due_date }\|{ notes })` | `updateItem()` + `router.refresh()` |
| create / rename / delete a folder | `useFolderActions().addFolder / renameFolder / removeFolder` | `createFolder()` + `router.refresh()` |
| read items/folders server-side | `await getInboxTree()` / `await getFolders()` in the page | `await supabase.from('items')…` inline |
| 404 on a missing folder | page calls `notFound()` after `getFolder(id)` returns `null` | put `notFound()` inside the data layer |
| test a store-reading component | `renderWithProviders(ui, { folders, tasks })` from `lib/test-utils` | naked `render()` (throws on missing context) |

## The Optimistic Mutation Recipe (reusable)

Every store action follows the same shape. Use it when adding a new mutation **or
refactoring an existing hard-refresh one**. The pure forest edits live in `lib/tree.ts`
(`updateNode`, `removeNode`, `insertSubtree`, `insertChild`, `insertRoot`,
`makeOptimisticItem`, `findNode`); the store reducer just delegates to them.

1. **Capture** the pre-mutation value for rollback (read the latest state from a ref —
   see the ref pattern below). For removals, `removeNode` returns
   `{ removed, parentId, index }`; for edits, grab the previous node via `findNode`.
2. **Dispatch the optimistic change** synchronously (insert temp node / patch / remove).
   For a create, build the placeholder with `makeOptimisticItem` (a `temp-…` id).
3. `await` the **`lib/api-client`** call.
4. On success, **reconcile**: dispatch a `replace` with the returned row (swaps the temp id
   for the server id, applies server-canonical fields).
5. On failure, **roll back** the exact change (re-insert the captured subtree at its index /
   restore the previous field value) and **re-throw** so the caller can react (e.g. keep an
   edit form open, show an error).

Reference implementations: `tasks-store.tsx` (`addTask`, `completeTask`, `updateTask`,
`moveTask`, `deleteTask`) and `folders-store.tsx`.

### Non-negotiable invariants

- **Reconcile replaces scalar fields and KEEPS the node's `children`.** The API returns a
  flat `Item` (no `children` key), so `updateNode(forest, id, serverRow)` preserves the
  locally-accumulated subtree — without this, a fast create-parent-then-create-child loses
  the child on reconcile.
- **Reconcile is a no-op for an id no longer in the store.** `updateNode`/`replace` add
  nothing when the id is gone — this is the race rule that stops an out-of-order reconcile
  from resurrecting a node a later action removed. Rollback is **per-id and targeted**,
  never a whole-tree snapshot restore (which would clobber a concurrent success).
- **Split state and actions into two contexts.** Actions are memoized (`useMemo([])`) and
  stable, so components that only mutate don't re-render when the tree changes — this
  matters for the recursive `TaskRow`.
- **Read latest state for rollback via a `useEffect`-synced ref**, never a render-body
  write: `react-hooks/refs` forbids `ref.current = x` during render. Use
  `useEffect(() => { ref.current = state }, [state])`; actions fire from user events after
  commit, so the ref is current when they run.
- **Seed-once vs remount-by-key.** `FoldersProvider` seeds once at layout mount and is
  authoritative for the session — **no key, no prop-sync effect** (both would wipe
  optimistic state on navigation). `TasksProvider` is per-route; the **folder page uses
  `key={id}`** to re-seed on folder→folder navigation, but the **inbox provider must NOT
  key on `?view`** — the inbox list stays mounted across the open/close toggle, so keying on
  `view` would discard the user's optimistic edits. (Next's client Router Cache may serve a
  briefly-stale RSC payload on back-navigation; acceptable for a single-user app.)

## Common Pitfalls (the anti-patterns this architecture removes)

- **Never create a supabase client in a component** (`createClient()` from
  `lib/supabase/*`). The only exception is auth in `login-form.tsx`. Components read from
  the stores and mutate via store actions.
- **Never inline `supabase.from('…')` in a Server Component.** Add/clarify a `lib/data/*`
  reader instead — that module is the single home for read queries.
- **Never call `lib/api-client` directly from a component, and never `router.refresh()`
  after a mutation.** Both are the old hard-refresh pattern; route through a store action so
  the change is optimistic and reconciles locally. (If you find a `router.refresh()` in a
  mutation handler, that's a refactor target — wire it to a store action.)
- **Never prop-drill `folders` or `nodes`.** They come from `useFolders()` / `useTasks()`.
- **Never fake optimism with a local `dismissed`/`isPending` flag** to hide a row while a
  request is in flight. The store removes it from the forest and the list re-renders; a
  rollback remounts it.
- **Never mirror server data in ad-hoc `useState`.** The store is the cache. Local state is
  only for transient UI (which row is expanded, the current input draft).

## File Map

- `frontend/lib/data/{folders,items}.ts` — server-only read layer (`import 'server-only'`).
- `frontend/lib/stores/{folders-store,tasks-store}.tsx` — Context stores + optimistic actions.
- `frontend/lib/tree.ts` — pure forest edits the reducers delegate to.
- `frontend/lib/api-client.ts` — typed `fetch` wrappers over the `app/api/**` route handlers.
- `frontend/app/api/**/route.ts` — the HTTP write boundary (auth + validation + Supabase).
- `frontend/app/(tasks)/layout.tsx` — mounts `FoldersProvider` (seed-once).
- `frontend/app/(tasks)/{page,completed/page,folders/[id]/page}.tsx` — mount `TasksProvider` per route.
- `frontend/lib/test-utils.tsx` — `renderWithProviders` for store-reading component tests.

## What's Deliberately Left Out

- **Realtime / multi-device sync.** Single-user; the store is the session cache and a hard
  reload re-seeds. Add Supabase realtime here only if multi-device live sync becomes a goal.
- **A third-party state library (Zustand/Jotai/Redux/react-query).** Deliberately not used —
  Context + `useReducer` + the pure `lib/tree.ts` helpers cover the need with zero deps.
  `useSyncExternalStore` would be the integration point if an external store is ever adopted.
- **Mutations from Server Components (Server Actions).** Writes go through `lib/api-client`
  → route handlers so the same endpoints serve external ingress (e.g. Siri) and the client.
