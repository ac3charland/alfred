# ALF-22 — Add ability to create stories directly from the project view

> **Status:** Refinement spec. Hand to an implementation session.
> **Module:** Software Factory (`code`). See [`docs/specs/code-module/code-module-spec.md`](code-module/code-module-spec.md) §4 (schema / RPCs), §7 (entering the factory), §9 (board), §14 (data flow & stores).

## Context / problem

In the Software Factory, a **code story** is an `items` row (`item_type = 'code'`) plus a
`code_items` sidecar that carries its `factory_state`, ref, and PR links. The board
(`frontend/components/code/board.tsx`) renders a project's epics stacked vertically, each epic
expanding into swimlanes of `StoryCard`s.

Today a story can come into existence **only by admitting a pre-existing `items` row to the
factory** — the gate. `enter_code_module(p_item, p_project, p_epic)` (`database/migrations/0002_software_factory.sql`
L116–129) flips an *existing* item to `item_type = 'code'`, clears its task-only fields, and creates
the sidecar at `needs_refinement` with a server-allocated ref. The UI entry points are all from the
Tasks side: "Send to Code module" / "Convert to Code Story" open `GateDialog`
(`frontend/components/code/gate-dialog.tsx`), which calls `api.enterCodeModule` →
`POST /api/code` → the RPC.

So **from the project view itself there is no way to create a new story**. If you're looking at an
epic on the board and want to add a story to it, you must leave the board, capture a task in the
inbox, then gate it back into this same project + epic. That's a needless round-trip for the common
case of "I'm planning this epic and want to jot the stories that belong in it."

This ticket closes that gap: a **`+` button on the epic header — immediately to the left of the
existing three-dots actions menu — opens a small modal that creates a brand-new story directly into
that epic** (no inbox item required). Because the `+` lives on a specific epic, the target project
and epic are already known; the user only supplies the story's title (and, optionally, notes).

## Proposed change

Add a "new story" path that mints a **fresh `items` row *and* its `code_items` sidecar in one
atomic step**, scoped to the epic the `+` was clicked on, landing at `needs_refinement` exactly like
a gated story. This requires a new DB RPC (the existing `enter_code_module` only *flips* an existing
item, so it can't be reused), a new API entry shape, a new optimistic store action, and the board UI.

### 1. Database: a `create_code_story` RPC (new migration)

> **✅ Applied 2026-06-22.** `database/migrations/0004_create_code_story.sql` exists and the
> `create_code_story` RPC has been applied to the live Supabase project — verified `SECURITY INVOKER`,
> returns `code_items`, `EXECUTE` granted to `anon` / `authenticated` / `service_role`. No
> `database.types.ts` regeneration was needed. The rest of ALF-22 (API shape, store action, board UI,
> tests, demo) is still unbuilt.

`enter_code_module` updates an existing item; creating a story from scratch must **insert** the
item first. Add `database/migrations/0004_create_code_story.sql` with a sibling RPC that mirrors
`enter_code_module`'s ref-allocation and return shape (the original `0003` slot is now taken by
`0003_realtime_code_items.sql`, so this migration lands at `0004` — it depends only on `0002`, so
ordering after the realtime migration is fine):

```sql
-- Create a brand-new code story from the project view: insert the item AND its
-- code_items sidecar in one transaction, landing at needs_refinement. Mirrors
-- enter_code_module (0002 §7) but inserts a fresh item instead of flipping an
-- existing one — there is no inbox row to admit. notes is optional (NULL).
create or replace function create_code_story(
  p_project uuid, p_epic uuid, p_title text, p_notes text default null
) returns code_items language plpgsql security invoker as $$
declare n int; k text; v_item uuid; row code_items;
begin
  select key into k from projects where id = p_project;
  n := next_code_ref(p_project);
  insert into items (title, notes, item_type)
  values (p_title, p_notes, 'code')
  returning id into v_item;
  insert into code_items (item_id, project_id, epic_id, ref_number, ref)
  values (v_item, p_project, p_epic, n, k || '-' || n) returning * into row;
  return row;
end; $$;

grant execute on function create_code_story(uuid, uuid, text, text)
  to anon, authenticated, service_role;
```

- The new item is created **clean** (`item_type = 'code'`, no due date / parent / completed status),
  so the `items_task_only_fields` CHECK (`0002` L155) holds without clearing anything.
- `security invoker` + the existing `code_items` / `items` RLS policies govern access exactly as the
  other RPCs do; no new policy is needed.
- Returns the `code_items` row (same return type as `enter_code_module`), so the API and store reuse
  the existing reconcile path unchanged.
- **Sandbox limitation (code-module-spec §4):** `supabase db push` needs live credentials a CI/web
  sandbox lacks. A sandbox session writes the migration file; **applying `0004` was a local,
  credentialed step, now done** (see the status note above). No `database.types.ts` regeneration is required — the RPC
  returns the existing `code_items` row type, and `supabase gen types` would only add the function
  signature, which the client does not depend on.

### 2. API: a "create new story" shape on `POST /api/code`

`POST /api/code` (`frontend/app/api/code/route.ts`) is "create a code story"; today its only shape is
the gate (`{ item_id, project_id, epic_id }` → `enter_code_module`). Add a **second, discriminated
shape** for from-scratch creation so the route keeps one clear responsibility:

- Extend `createCodeSchema` (`frontend/lib/api/schemas.ts`) into a discriminated union:
  - **gate** (existing): `{ item_id: uuid, project_id: uuid, epic_id: uuid }`.
  - **new** (added): `{ title: non-empty trimmed string, notes?: string | null, project_id: uuid,
    epic_id: uuid }` — no `item_id`.
- In the `POST` handler, branch on which shape parsed: the gate branch calls `enter_code_module`
  (unchanged); the new branch calls `supabase.rpc('create_code_story', { p_project, p_epic, p_title,
  p_notes })`. Both `.single()` and return `jsonOk(data, 201)` with the `code_items` row.
- Add `api.createCodeStory(projectId, epicId, title, notes)` to `frontend/lib/api-client.ts`,
  modelled on `createEpic` / `enterCodeModule`, POSTing the new shape and typed `Promise<CodeItem>`.
  Keep the `null`-for-empty-notes handling in this `lib/` layer (the null-aware boundary, per the
  `data-flow` / `supabase` skills): an empty notes field sends `null`, not `''`.

(Alternative considered: a dedicated route. Rejected — both shapes produce a `code_items` sidecar at
`needs_refinement` and return the same row, so one route reads more cohesively. Noted as a
non-blocking option under Out of scope.)

### 3. Store: a `createStory` optimistic action

Add to the `CodeActions` interface and its implementation in
`frontend/lib/stores/code-store.tsx`, modelled on the existing `admitToFactory` helper but minting a
**temporary item id** for the optimistic card (the real `item_id` is server-allocated, unlike the
gate where the item already exists):

```ts
createStory: (epicId: string, title: string, notes: string | null) => Promise<CodeStory>;
```

- Look up the epic in `stateRef.current.epics` (throw if absent) and its project in
  `stateRef.current.projects` (throw if absent) — both are seeded on the board, mirroring
  `admitToFactory`'s guard. `projectId` is derived from `epic.project_id`, so the caller need only
  pass the epic.
- Build an optimistic `CodeStory` via a small builder modelled on `makeOptimisticStory`, but seeded
  with a **`tempId()` `item_id`**, the supplied `title` / `notes`, `source_url: null`,
  `factory_state: 'needs_refinement'`, `lane: 'human'`, and the joined project/epic display fields.
  `dispatch({ type: 'insertStory', story: optimistic })`.
- `await api.createCodeStory(epic.project_id, epicId, title, notes)`; on success build the reconciled
  row from the optimistic row **plus the saved sidecar's real `item_id`, `ref`, `ref_number`,
  `factory_state`, `lane`, and timestamps** — note this reconcile must also replace `item_id` (the
  temp id → the server uuid), unlike `reconcileStory` which keeps the existing id. Dispatch
  `{ type: 'replaceStory', itemId: <tempId>, story: reconciled }` (keyed by the temp id) and return
  the reconciled story.
- On error, `dispatch({ type: 'removeStory', itemId: <tempId> })` and rethrow — same rollback shape
  as `admitToFactory`.

The reducer's `insertStory` / `replaceStory` / `removeStory` already exist and need no change
(`replaceStory` looks up by the passed `itemId`, so swapping the temp-id row for the real one works).

### 4. Board UI: the `+` button + a `NewStoryDialog`

In `EpicBlock` (`frontend/components/code/board.tsx`), add a `+` trigger **immediately to the left of
the three-dots `DropdownMenu`** (the `MoreHorizontal` button, L307–317). It renders in the same
non-editing branch as the menu (`editingTitle ? null : …`), so it's hidden while the title is being
renamed, and matches the menu trigger's size/spacing (a ghost icon button, `h-7 w-7`, muted
foreground, `self-center`).

- **Icon:** `Plus` from `lucide-react` (size 15, matching `MoreHorizontal`).
- **`aria-label`:** `` `New story in ${epic.name}` `` so it's distinguishable from other epics' `+`.
- **Click:** opens a new `NewStoryDialog` for this epic (board-local `useState` for which epic's
  dialog is open, or per-`EpicBlock` open state — implementer's choice; keep it ephemeral session UI
  like the collapse Set).
- Place the `+` **before** the `DropdownMenu` in the JSX so it sits to the menu's left; keep both
  inside the `<h3>` actions cluster.

Add `frontend/components/code/new-story-dialog.tsx`, modelled on `NewEpicDialog`
(`new-epic-dialog.tsx`) — a Radix `Dialog` whose **stateful body is a child component that mounts
fresh on open** (so the draft resets without a setState-in-effect, the established pattern in
`gate-dialog.tsx` / `new-epic-dialog.tsx`):

- **Title:** `Dialog.Title` "New story in {epicName}" (or "New story" with the epic ref shown), and a
  `Dialog.Description` noting it will be created at Needs Refinement.
- **Fields:** a required **Title** text input (autofocused on mount) and an optional **Notes**
  `textarea` (reuse the dense textarea styling from `EpicHeaderActions` / the story-detail notes
  editor). Use `FieldLabel` for both.
- **Submit ("Create"):** disabled until the title is non-empty (trimmed) and not already submitting;
  on submit, trim the title, map empty notes → `null`, call the injected
  `onCreateStory(title, notes)` (the board wires this to `useCodeActions().createStory(epic.id, …)`),
  close on success, and surface an inline error (e.g. "Could not create the story. Try again.") on
  rejection without closing — mirroring `gate-dialog.tsx`'s `confirmError` handling.
- **Cancel / Escape / overlay click:** close without writing.
- Preserve the dark, dense aesthetic and existing tokens; no new dependencies. Reuse the `Button`
  primitive for Cancel/Create with the same accent-teal Create styling the gate uses.

The optimistic `insertStory` makes the new card appear in the epic's **Needs Refinement** swimlane
immediately, then reconciles with the real ref (mirroring the gate's behavior on the board).

### 5. Tests & demo

- **DB / API:** extend `frontend/app/api/code/route.test.ts` — the new-story body shape calls
  `create_code_story` with the right params and returns the sidecar `201`; a body missing `title`
  (and `item_id`) is `400`; the existing gate shape still routes to `enter_code_module` (no
  regression). Mock the Supabase client / RPC as the existing tests do.
- **Store (jest)** — `code-store.test.tsx`: `createStory` inserts an optimistic story into the
  epic at `needs_refinement` keyed by a temp id, then `replaceStory` swaps in the server row with the
  real `item_id` + `ref`; a rejected create removes the optimistic card (rollback); a missing
  epic/project throws. Mock `@/lib/api-client.createCodeStory`.
- **RTL** — `new-story-dialog.test.tsx`: Create is disabled until the title is non-empty; submitting
  calls `onCreateStory` with the trimmed title and `null` for empty notes; Cancel/Escape closes
  without calling it; a rejected create shows the inline error and keeps the dialog open. A board
  test asserts the `+` (by its `aria-label`) sits in the epic header and opens the dialog.
- **Storybook** — add/adjust a board or dialog story so the `+` button and the open `NewStoryDialog`
  are covered by the snapshot gate; follow the `storybook` capture → approve flow if a baseline moves.
- **Demo doc** (`docs/demos/ALF-22/…` via `npm run demo`): from the board, click an epic's `+`, fill
  the title, create, and show the new card appear in that epic's Needs Refinement lane with its
  allocated ref; screenshot the board. Note the live-Supabase requirement for end-to-end persistence
  (the §1 sandbox limitation) if the demo is captured locally.

## Acceptance criteria

- [ ] Each epic header on the board shows a `+` button **immediately to the left of the existing
      three-dots actions menu**, matching its size/spacing, hidden while the epic title is being
      renamed, with an `aria-label` naming the epic (e.g. "New story in {epic name}").
- [ ] Clicking the `+` opens a modal scoped to that epic with a required **Title** field (autofocused)
      and an optional **Notes** field; the modal states the story will be created at Needs Refinement.
- [ ] Create is disabled until the title is non-empty; submitting creates a **new** story (a fresh
      `items` row + `code_items` sidecar) in **that epic's project and epic** at `needs_refinement`
      with a server-allocated ref — no inbox/task item is involved.
- [ ] Empty notes persist as `null` (not `''`); a supplied notes value persists on the new item.
- [ ] The new card appears optimistically in the epic's Needs Refinement swimlane, then reconciles
      with the server row (real `item_id` + `ref`); a failed create rolls the optimistic card back.
- [ ] Cancel / Escape / overlay-click closes the modal without creating; a server error shows an
      inline message and keeps the modal open.
- [ ] Creation goes through a new `create_code_story` RPC (migration `0004`), a new discriminated
      shape on `POST /api/code` → `api.createCodeStory`, and a new optimistic `createStory` store
      action. `enter_code_module` and the existing gate flow are unchanged.
- [ ] Tests cover the API branch (new + gate), the store optimistic/rollback path, and the dialog
      (validation, trim, null-notes, cancel, error); `check` is green and the change is captured in a
      demo doc.

## Out of scope / open questions

- **Applying migration `0004` (local/credentialed) — ✅ done 2026-06-22.** Applied directly with
  `psql` over the session pooler against the live project and verified. End-to-end verification through
  the app still waits on the unbuilt frontend (API shape, store action, board UI).
- **Editing the new story's project/epic in the dialog.** The `+` is epic-scoped, so the project and
  epic are fixed by where it was clicked — the dialog does **not** offer project/epic selectors (that's
  the gate's job for *moving* an inbox item). Moving a story between epics is a separate concern, not
  built here.
- **Creating from the project level (not an epic).** This ticket adds creation **per epic** only. A
  project-level "new story" (which would need an epic picker) or an "uncategorised" story with no epic
  is out of scope — the schema requires `code_items.epic_id`.
- **Choosing an initial factory state.** New stories always start at `needs_refinement`, like gated
  stories; the dialog does not let the user pick a starting lane.
- **Setting a spec / PR links / lane at creation.** Those are Worker-/lifecycle-owned fields
  (code-module-spec §5, §13) and remain empty on a fresh story.
- **Inline (no-modal) creation on the board** — e.g. an "add story" row inside a swimlane. Out of
  scope; creation is via the epic-header `+` modal, consistent with how epics/projects are created.
- **API surface (non-blocking):** this spec extends `POST /api/code` with a discriminated body rather
  than adding a dedicated route, because both shapes create a `code_items` sidecar at
  `needs_refinement`. If review prefers a separate endpoint, that's a drop-in swap with no change to
  the RPC, store action, or UI — flag it on the PR rather than blocking on it here.
