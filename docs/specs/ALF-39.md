# ALF-39 — Add ability to move stories to different epics

> **Status:** Refinement spec. Hand to an implementation session.
> **Module:** Software Factory (`code`). See [`docs/specs/code-module/code-module-spec.md`](code-module/code-module-spec.md) §7 (item/epic model), §9 (board/swimlanes), §10 (story detail modal).

## Context / problem

A code story is an `items` row + a 1:1 `code_items` sidecar, and the **epic it belongs to is
`code_items.epic_id`** (`database/migrations/0002_software_factory.sql` — `epic_id uuid not null
references epics(id)`). The board groups stories under their epic via `buildEpicBoard`, which filters
`story.epic_id === epic.id` (`frontend/lib/stores/code-store.tsx`), and the detail modal shows the
epic only as static breadcrumb text (`Project › Epic` in `DetailBody`,
`frontend/components/code/story-detail-modal.tsx`).

A story's epic is chosen **once, at the gate** (`enter_code_module(item, project, epic)`), and there
is currently **no way to change it afterwards**. If a story is filed under the wrong epic, or work is
reorganised across epics, the only recourse is to abandon and re-admit the item. The detail modal can
edit the story's **title** (`EditableTitle` → `updateStoryTitle`) and its **state** (`ManualControls`
→ `updateCodeState`), but the epic is frozen.

This ticket makes a story's epic **changeable from the detail modal** ("the ticket view"): a dropdown
of the **other epics in the same project** lets the user move the story to a different epic, and the
card immediately re-homes under that epic on the board — reusing the module's existing optimistic
store + reconcile/rollback pattern, with no schema change (the column already exists).

## Proposed change

Add an **epic dropdown** to the story detail modal and a **`moveStoryToEpic`** optimistic store action
backing it, plus the thin API surface to PATCH `code_items.epic_id`. Scope is the **code module only**.

### 1. API: accept `epic_id` on the existing sidecar PATCH

`epic_id` lives on `code_items`, and `PATCH /api/code/[ref]` already updates that table keyed by
`ref` (`frontend/app/api/code/[ref]/route.ts`). Extend that one route rather than adding an endpoint:

- **Schema** (`frontend/lib/api/schemas.ts`, `updateCodeSchema`): today it requires `factory_state`.
  Make `factory_state` **optional**, add `epic_id: uuid.optional()`, and add a `.refine(...)` that
  **at least one** updatable field is present (so an empty PATCH is a 400). The existing
  state-transition callers still send `factory_state`, so they are unaffected.
- **Route** (`[ref]/route.ts`): build `updates: CodeItemUpdate` from whichever keys are present —
  forward `factory_state` and `blocked_reason` exactly as today, and forward `epic_id` when provided.
- **Cross-project guard.** An epic belongs to exactly one project, and a story's `ref`/`project_id`
  are tied to its project; moving a story to an epic in a *different* project would desync them.
  Before applying an `epic_id` change, the route must verify the **target epic's `project_id` matches
  the story's `project_id`** and return **400** otherwise. (The UI only ever offers same-project
  epics — see §3 — so this is defence-in-depth, not the happy path.) Fetch the story's
  `project_id` (the `code_items` row by `ref`) and the target epic's `project_id` (the `epics` row by
  id) and compare; reject on mismatch or a missing/unknown epic.

No migration: `code_items.epic_id` already exists and `v_code_stories` already exposes `epic_id`,
`epic_name`, `epic_ref`, and `epic_archived_at` via its join on `epics`.

### 2. API client: `moveCodeEpic`

Add to `frontend/lib/api-client.ts`, beside `updateCodeState`:

```ts
/** Move a code story to a different epic in the same project. PATCHes the sidecar's
 *  epic_id by ref and returns the updated code_items row. */
export function moveCodeEpic(ref: string, epicId: string): Promise<CodeItem> {
  return apiRequest<CodeItem>(`/api/code/${encodeURIComponent(ref)}`, {
    method: 'PATCH',
    body: JSON.stringify({ epic_id: epicId }),
  });
}
```

A named, intent-revealing function (like `moveToInbox`) rather than overloading `updateCodeState`.

### 3. Store: a `moveStoryToEpic` action

Add `moveStoryToEpic(ref: string, epicId: string): Promise<void>` to the `CodeActions` interface and
its implementation in `frontend/lib/stores/code-store.tsx`, modelled on `updateCodeState`
(keyed by `ref`) — the board re-groups the card the instant `epic_id` changes in the store, because
`buildEpicBoard` filters on `story.epic_id`.

The board read shape (`CodeStory`, the flattened view) carries **denormalised** epic fields
(`epic_name`, `epic_ref`, `epic_archived_at`) that the saved `code_items` row does **not** return, so
the optimistic patch must source them from the **target epic already in the store**:

- Find the story by `ref` in `stateRef.current.stories`; throw if absent. Narrow its `item_id` (the
  view type is all-nullable; a seeded story always has one) for the `patchStory` dispatch key.
- Find the target epic by `epicId` in the store's epics; throw if absent.
- Capture `rollback: Partial<CodeStory> = { epic_id, epic_name, epic_ref, epic_archived_at }` from the
  story's current values.
- Optimistically `dispatch({ type: 'patchStory', itemId, patch: { epic_id: target.id,
  epic_name: target.name, epic_ref: target.ref, epic_archived_at: target.archived_at } })`.
- `await api.moveCodeEpic(ref, epicId)`, then reconcile with a patch confirming the sidecar fields the
  saved row carries: `{ epic_id: saved.epic_id, code_updated_at: saved.updated_at }` (the denormalised
  name/ref/archived_at were already applied optimistically from the store's epic and need no server
  echo).
- On error, dispatch the `rollback` patch and rethrow.

To let the modal list candidate epics, **export a public `useEpics(): Epic[]` hook** (the private
`useCodeEpics` already reads the epics slice — export a public wrapper, mirroring `useProjects`). The
modal filters this list itself (§3 below). No reducer change — `patchStory` already exists.

### 4. Modal: the epic dropdown

In `DetailBody` (`story-detail-modal.tsx`), turn the **Epic** segment of the `Project › Epic`
breadcrumb into a **dropdown** that moves the story. Reuse the shadcn `DropdownMenu` primitives
already used on the board (`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`,
`DropdownMenuItem`) — `board.tsx` is the reference for import + usage.

- **Project stays read-only text.** Only the epic segment becomes interactive (a button trigger
  showing the current `epic_name` with a small chevron affordance, matching the dark/dense aesthetic
  and the title/notes hover-affordance feel).
- **Candidate list.** From `useEpics()`, take epics where `project_id === story.project_id`, **exclude
  the story's current `epic_id`**, and **exclude archived epics** (`archived_at !== null`) — moving a
  story onto an archived epic would hide it from the active board. Order oldest-first (board order).
  Each becomes a `DropdownMenuItem` labelled with the epic name (and its `epic.ref`, muted, like the
  board's epic header). The current epic is shown as the trigger label, not as a selectable item.
- **Empty state.** If there are no other (active, same-project) epics, render the epic as **plain
  text** (no trigger / disabled), so a single-epic project has no dead dropdown.
- **Selecting an item** calls `moveStoryToEpic(story.ref, epic.id)`. Guard a null `ref`/`item_id`
  exactly as `EditableTitle`/`ManualControls` guard (the view type is all-nullable). On the store's
  rejection, do nothing extra — the store already rolled the row back, and the modal re-reads the live
  row by `item_id` so the breadcrumb reverts.
- The modal keeps tracking the open story by `item_id` (board behaviour), so after a move the
  breadcrumb reflects the new epic live; the card simultaneously appears under the new epic block.

Keep the existing `useCodeActions()` usage (the modal already reads it). No new dependency.

### 5. Tests & demo

- **Jest** (`code-store.test.tsx`): `moveStoryToEpic` optimistically patches `epic_id` + the
  denormalised epic fields from the target epic, reconciles on success (asserts the story now groups
  under the new epic via `useProjectBoard`/`buildEpicBoard`), and **rolls all four fields back** when
  `api.moveCodeEpic` rejects; an unknown `ref` or unknown target epic throws. Mock `@/lib/api-client`.
- **RTL** (`story-detail-modal.test.tsx`): the epic dropdown lists the project's **other active**
  epics (and not the current one, not archived ones, not other projects'); selecting one calls
  `moveStoryToEpic(ref, epicId)`; a single-epic project renders the epic as plain text with no
  trigger. Extend the file's existing store-action mock harness.
- **API route** (`app/api/code/[ref]/route.test.ts`): a body of `{ epic_id }` updates the sidecar and
  returns the row; a target epic in a **different project** is rejected **400**; an empty body is
  **400**. **Schema** test (if `schemas` has its own test): `factory_state`-only, `epic_id`-only, and
  both validate; empty fails.
- **Demo doc** (`docs/demos/ALF-39/…` via `npm run demo`): open a story under epic A, pick epic B from
  the dropdown, show the card move to epic B's block and the breadcrumb update; reopen to show it
  persisted. Screenshot the board before/after per the `showboat` skill.

## Acceptance criteria

- [ ] The story detail modal's `Project › Epic` breadcrumb exposes the **epic** as a dropdown listing
      the **other, non-archived epics in the same project** (current epic excluded, archived excluded,
      other projects' epics excluded), each labelled with its name + ref.
- [ ] Selecting an epic moves the story to it: the card immediately re-homes under that epic's block on
      the board and the modal breadcrumb updates live, with **no manual refresh** — via an optimistic
      `moveStoryToEpic` store action that patches `epic_id` + the denormalised `epic_name`/`epic_ref`/
      `epic_archived_at`, then reconciles with the saved `code_items` row.
- [ ] A failed move rolls the story back to its original epic (card and breadcrumb both revert).
- [ ] The move persists via `PATCH /api/code/[ref]` carrying `{ epic_id }` (through a new
      `moveCodeEpic` api-client helper); `updateCodeSchema` accepts `epic_id` with `factory_state`
      now optional, and rejects an **empty** body. Existing state-transition callers are unchanged.
- [ ] The route rejects (400) an `epic_id` whose epic is in a **different project** than the story (or
      is unknown); the UI never offers such an epic.
- [ ] A project with no other active epic shows the epic as plain text (no dead dropdown).
- [ ] No database migration (the `code_items.epic_id` column and the `v_code_stories` epic fields
      already exist).
- [ ] Tests cover the store action (optimistic move, reconcile, rollback, unknown-ref/epic), the modal
      dropdown (candidate filtering + the move call + the single-epic plain-text case), and the route
      (epic_id update, cross-project 400, empty-body 400); `check` is green and the change is captured
      in a demo doc.

## Out of scope / open questions

- **Moving across projects.** Deliberately excluded: a story's `ref` and `project_id` are tied to its
  project, so a cross-project move would require ref re-allocation. The dropdown is same-project only
  and the route guards it.
- **Moving to an archived epic.** Excluded — it would hide the story from the active board. (Open
  question, flag don't block: if reviewers want "move to archived epic", it would need the archived
  epics surfaced in the dropdown and the board's Show-archived behaviour considered.)
- **Drag-to-move between epics on the board.** Out of scope (code-module-spec §9.2 keeps the board
  read-only for placement); this ticket adds the move only from the detail modal.
- **Reassigning the project/epic at the gate** — already exists (the gate picks both at admit time);
  unchanged here.
- **Bulk move** (re-home several stories at once) — out of scope; one story per modal.
- **Epic CRUD from the modal** (create a new epic inline while moving, rename/archive) — out of scope;
  epics are created/renamed/archived from the board (`EpicBlock`/`EpicHeaderActions`) as today. The
  dropdown only re-targets among existing epics.
</content>
</invoke>
