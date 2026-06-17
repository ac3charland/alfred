# ALF-33 — Surface API errors as toasts

> **Status:** Refinement spec. Hand to an implementation session.
> **Module:** Tasks + Code (shared frontend). Touches the optimistic stores
> (`frontend/lib/stores/*`), the shared `AppShell`, and both module layouts.
> See the `data-flow` skill (optimistic + reconcile/rollback) and the existing toast
> infrastructure (`frontend/lib/stores/toast-store.tsx`).

## Context / problem

Every mutating action in alfred's frontend follows one recipe (the `data-flow` skill's
optimistic + reconcile/rollback pattern): the store dispatches an **optimistic** change,
calls the API, and on failure **rolls the change back** and **re-throws** the error. For
example `updateTask` in `frontend/lib/stores/tasks-store.tsx`:

```ts
async updateTask(id, patch) {
  const previous = tasksRef.current.find((item) => item.id === id);
  dispatch({ type: 'patch', ids: [id], patch });
  try {
    const saved = await api.updateItem(id, patch);
    dispatch({ type: 'upsert', items: [saved] });
  } catch (error) {
    if (previous) dispatch({ type: 'upsert', items: [previous] });
    throw error; // ← re-thrown to the caller
  }
}
```

The re-thrown error reaches the component call site, where it is **swallowed in a silent
`catch`**. Every such site in `frontend/components/**` looks like this (from `task-row.tsx`):

```ts
try {
  await updateTask(node.id, { title: newValue });
} catch {
  // The store reverted the title; reset the draft for the next edit.
  setDraftTitle(node.title);
}
```

So when a write fails — network drop, 4xx/5xx, an auth expiry — the optimistic change
**silently snaps back** and the user is given **no explanation**. The work looks like it
saved, then quietly undoes itself. There is no signal that anything went wrong or that the
action should be retried. This is the gap ALF-33 closes: **a failed API mutation must tell
the user it failed.**

The pieces to do this already exist and are unused for errors:

- A toast queue — `ToastProvider` + `useToastActions().showToast(message)` +
  `ToastViewport` (an `aria-live="polite"` region, `frontend/components/shell/toast-viewport.tsx`).
- It is currently fired for exactly one **success** case — `showToast(\`Created ${story.ref}\`)`
  in `task-row.tsx` (the gate). No error path uses it.

### The one structural obstacle: provider nesting

We want the toast fired **once, centrally, at the rollback point in the store** (see the
resolved decision below) — not duplicated into ~15 component `catch` blocks. But today the
store providers wrap `AppShell`, and `ToastProvider` lives **inside** `AppShell`:

```
TasksProvider / FoldersProvider / CodeProvider   ← stores (in the layouts)
  └─ AppShell
       └─ ToastProvider                            ← toast context starts HERE
            └─ ToastViewport
```

So a store action **cannot** call `useToastActions()` — the provider is its descendant.
The first part of this change is to **lift `ToastProvider` above the store providers** so
the stores can fire toasts.

### Resolved decisions (settled with the requester during refinement)

- **Centralized, not per-call-site.** Fire the toast at the single rollback point inside
  each store action, not in every component `catch`. One source of truth; new actions
  inherit the behavior; no call site can forget it.
- **Mutation writes only.** Scope is failed **optimistic store write actions**. Read/load
  failures (e.g. the gate dialog's `listProjects`/`listEpics`, which already render inline
  "Could not load…" messages) keep their existing inline UX and are **out of scope** (see
  below).

## Proposed change

### 1. Lift `ToastProvider` above the store providers

Move the `ToastProvider` boundary up so all three stores sit inside it.

- **`frontend/components/shell/app-shell.tsx`** — remove the `<ToastProvider>` wrapper.
  Keep `<ToastViewport />` exactly where it renders (it now relies on an **ancestor**
  `ToastProvider` supplied by the layout). `AppShell` returns its existing tree wrapped in
  a fragment instead of `ToastProvider`.
- **`frontend/app/(tasks)/layout.tsx`** — add `<ToastProvider>` as the **outermost**
  wrapper, above `FoldersProvider`:

  ```tsx
  <ToastProvider>
    <FoldersProvider initialFolders={folders}>
      <TasksProvider initialTasks={items}>
        {/* …existing TaskDndProvider / ActiveEditorProvider / ExpansionProvider / AppShell… */}
      </TasksProvider>
    </FoldersProvider>
  </ToastProvider>
  ```

- **`frontend/app/(code)/layout.tsx`** — add `<ToastProvider>` as the outermost wrapper,
  above `CodeProvider`.

The runtime DOM is unchanged (`ToastViewport` still renders in the same spot); only the
React provider order changes so the stores are now inside the toast context.

> **Note — tests already assume this order.** `frontend/lib/test-utils.tsx`
> (`renderWithProviders`) **already** nests `ToastProvider` outermost, above
> `FoldersProvider`/`TasksProvider`, with a `ToastViewport`. So RTL component tests need no
> structural change; this step simply makes the real layouts match what the test harness
> already does.

### 2. Give each store provider stable access to `showToast`

The action objects are memoized with empty (`[]`) deps and **must stay stable** — this is
a deliberate, Stryker-annotated invariant in `tasks-store.tsx` (and mirrored in the other
stores). To call `showToast` from inside those stable closures without adding it to the
dep array, capture it through a **ref** synced by an effect — the exact pattern the stores
already use for `tasksRef` / `stateRef`:

```ts
const { showToast } = useToastActions();
const showToastRef = React.useRef(showToast);
React.useEffect(() => {
  showToastRef.current = showToast;
}, [showToast]);
```

To avoid repeating this in all three stores, extract a tiny helper next to the toast store
(e.g. `frontend/lib/stores/toast-store.tsx` exports `useErrorToast()` returning a stable
`notifyError: (message: string) => void` backed by the ref). Each store provider calls
`useErrorToast()` once and the action closures call `notifyError(message)`.

### 3. Fire `notifyError(message)` in every store write action's `catch`

In each catch block, **after** the rollback dispatch and **before** the existing
`throw error`, call `notifyError(<message>)`. The re-throw **stays** — components still
rely on it to reset local draft/UI state (e.g. `setDraftTitle`, `setIsConfirming`); this
change adds the toast, it does not change control flow.

Actions to cover (every action that calls the API and rolls back):

| Store | Action | Suggested message |
| --- | --- | --- |
| `tasks-store` | `addTask` | `Couldn't add task` |
| | `updateTask` (title / due date / notes) | `Couldn't save changes` |
| | `completeTask` | `Couldn't complete task` |
| | `uncompleteTask` | `Couldn't reopen task` |
| | `classifyItem` | `Couldn't update item` |
| | `moveTask` | `Couldn't move task` |
| | `reparentTask` | `Couldn't move task` |
| | `deleteTask` | `Couldn't delete task` |
| `folders-store` | create folder | `Couldn't create folder` |
| | rename folder | `Couldn't rename folder` |
| | delete folder | `Couldn't delete folder` |
| `code-store` | `createProject` | `Couldn't create project` |
| | `createEpic` | `Couldn't create epic` |
| | `enterCodeModule` / `convertTaskToCode` | `Couldn't send to Code module` |
| | `updateEpic` | `Couldn't save epic` |
| | `updateStoryTitle` | `Couldn't save title` |
| | `updateCodeState` | `Couldn't update story` |
| | `openClaudeSession` | `Couldn't start session` |

- `tasks-store.removeGatedItem` makes **no API call** (pure client-side drop) — **no
  toast**.
- **Do not leak the raw error.** `api-client`'s thrown `Error` message embeds the HTTP
  status and the response body (`API PATCH /api/… failed: 500 …`). Toasts use the
  human-readable messages above, never `error.message`.
- **Voice:** match the existing toast (`Created ALF-42`) — short, sentence case, no
  trailing period. Exact copy can be tuned in review; the table is the starting point. One
  toast per failed action (a multi-write action like `reparentTask`/`moveTask` has a single
  `catch`, so it fires once even though it issues several requests).

### 4. Tests

Per the back-pressure rule, every behavior is expressed in a test.

- **Store unit tests must wrap in `ToastProvider`.** The `makeWrapper` helpers in
  `frontend/lib/stores/tasks-store.test.tsx`, `folders-store.test.tsx`, and
  `code-store.test.tsx` currently render the store provider **alone**. Once the provider
  calls `useErrorToast()`/`useToastActions()`, an unwrapped render throws
  "must be used within a ToastProvider". Update each `makeWrapper` to wrap its store in
  `ToastProvider` (and keep the existing `renderHook` flow). This is required just to keep
  the suites green.
- **New unit tests (per store):** with the API mock rejecting, assert that a write action
  (a) still rolls the optimistic change back, (b) **fires `showToast` with the expected
  message**, and (c) still re-throws. Spy on `showToast` by capturing it from a real
  `ToastProvider` (e.g. render a probe with `useToasts()` and assert the queued message) or
  by mocking `useToastActions`, consistent with how existing tests assert toasts.
- **RTL (component) test:** render a row via `renderWithProviders` (already toast-ready),
  make the underlying API reject, perform an edit (e.g. save a title), and assert the
  error toast text appears in the `ToastViewport` **and** the field reverts. This proves the
  full path end-to-end (store → toast → screen).
- **Regression guard:** the existing success toast (`Created ALF-XX`) and the silent-revert
  behavior on success are unchanged.

### 5. Demo doc

Capture the new behavior with the demo CLI (`npm run demo`, `docs/demos/ALF-33/…`): with a
list open, force an API failure (e.g. stub the route to 500 via the existing
`frontend/scripts/mock-supabase.mjs` harness or `page.route` in a Playwright-driven capture),
edit a task, and show (screenshot) the optimistic change revert **with the error toast
visible**. Verify it reproduces with `npm run demo -- verify`.

### 6. Record the decision in the skill library

Per the CLAUDE.md compounding-learning rule, update the `data-flow` skill
(`.claude/skills/data-flow/SKILL.md`) to note that the optimistic rollback path now also
**fires a centralized error toast from the store**, and that `ToastProvider` is mounted
**above** the store providers (in the layouts) precisely so the stores can reach
`useToastActions()`. Capture the "stores sit above ToastProvider unless lifted" gotcha.

## Acceptance criteria

- [ ] `ToastProvider` wraps the store providers: it is the outermost provider in both
      `(tasks)/layout.tsx` and `(code)/layout.tsx`, and `AppShell` no longer mounts it
      (but still renders `ToastViewport`). The toast viewport renders in the same place at
      runtime.
- [ ] When **any** optimistic store write action fails (API rejects), the optimistic change
      rolls back (unchanged) **and** a toast with a human-readable message (per the table,
      copy tunable) appears in the `aria-live` viewport. The error is **not** dumped raw
      (no HTTP status / response body in the toast).
- [ ] The toast is fired **centrally in the store** (one place per action), not in
      component `catch` blocks; the store still re-throws so component-local UI reset
      (draft fields, `isConfirming`, etc.) is preserved.
- [ ] All write actions in `tasks-store`, `folders-store`, and `code-store` are covered;
      the client-only `removeGatedItem` (no API call) fires no toast.
- [ ] Read/load failures and component-direct writes that already have inline error UI (the
      gate dialog, new-project / new-epic dialogs) are unchanged (out of scope).
- [ ] The existing success toast (`Created ALF-XX`) still works.
- [ ] Tests cover: a failed write fires the right toast + still rolls back + still
      re-throws (unit, per store); the toast is visible on screen after a failed edit (RTL);
      store-test `makeWrapper`s are wrapped in `ToastProvider`. `check` is green and the
      change is captured in a demo doc.
- [ ] The `data-flow` skill records the centralized error-toast path and the provider-order
      requirement.

## Out of scope / open questions

- **Read / load failures.** Data-fetch failures (the gate dialog's `listProjects` /
  `listEpics`, which already show inline "Could not load…" text) keep their inline UX. Only
  failed **writes** become toasts here.
- **Component-direct writes with bespoke inline errors.** The gate dialog
  (`gate-dialog.tsx` → `api.enterCodeModule`, with its inline `confirmError`) and the
  new-project / new-epic dialogs call the API directly (not via a store action) and show a
  **contextual, in-form** error. That is better UX for a modal form than a corner toast, so
  they are left as-is. (The Code **store's** `enterCodeModule`/`convertTaskToCode` actions —
  used inside the board, not the gate dialog — are in scope and do toast.)
- **Toast variants / styling.** No error-specific styling, icon, or color — reuse the
  single existing toast style. Add a variant only if a later ticket needs it (the toast
  store explicitly defers variants until a second use).
- **Toast de-duplication / coalescing.** Rapid repeated failures will stack multiple
  toasts; no coalescing or rate-limiting is added here. Each is independently
  auto-dismissing (4s) and dismissable. Coalescing is a future enhancement if it proves
  noisy.
- **Retry affordance.** No "Retry" button in the toast — the message tells the user the
  action didn't persist; they re-perform it manually. An actionable retry is out of scope.
- **Success toasts for other actions.** This ticket adds **error** feedback only; it does
  not add success toasts beyond the existing `Created ALF-XX`.
- **Offline / global error handling.** No global network-status banner or offline detection;
  this is per-action feedback only.
