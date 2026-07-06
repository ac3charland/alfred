# ALF-40 — Add ability to edit story notes in code module

> **Status:** Refinement spec. Hand to an implementation session.
> **Module:** Software Factory (`code`). See [`docs/specs/code-module/code-module-spec.md`](code-module/code-module-spec.md) §10 (story detail modal).

## Context / problem

A code story is an `items` row + a `code_items` sidecar, and `notes` are a **generic base-item
field available on any item regardless of type** (code-module-spec §7.3). The Software Factory
already lets you edit a story's **title** inline from the detail modal (`EditableTitle` →
`updateStoryTitle` → `api.updateItem(itemId, { title })`) and lets you edit an **epic's** notes
from the board (`EpicHeaderActions` in `board.tsx` → `updateEpic`). But a **story's own notes are
rendered read-only** in the detail modal:

- `frontend/components/code/story-detail-modal.tsx` (`DetailBody`, the "Notes" block, ~L443–454)
  shows `story.notes` as static text ("No notes." when empty) with no way to edit them.

So once an item is in the factory, its notes are frozen from the code module's point of view —
the only way to change them is to leave the Code view. This ticket closes that gap by making story
notes editable directly in the detail modal, matching the editing affordances already present for
the story title and for epic notes.

## Proposed change

Make the **Notes** section of the story detail modal an **inline editor**, reusing the existing
optimistic-store pattern and the existing notes-editing UX from `EpicHeaderActions`.

### 1. Store: a `updateStoryNotes` action

Add `updateStoryNotes(itemId: string, notes: string | null)` to the `CodeActions` interface and
its implementation in `frontend/lib/stores/code-store.tsx`. Model it directly on the existing
`updateStoryTitle` action (same file):

- Find the current story by `item_id` from `stateRef.current.stories`; throw if absent.
- Capture `rollback: Partial<CodeStory> = { notes: previous.notes }`.
- Optimistically `dispatch({ type: 'patchStory', itemId, patch: { notes } })`.
- `await api.updateItem(itemId, { notes })`, then reconcile with
  `dispatch({ type: 'patchStory', itemId, patch: { notes: saved.notes } })`.
- On error, dispatch the `rollback` patch and rethrow.

`api.updateItem`'s `UpdateItemInput` already accepts `notes?: string | null`
(`frontend/lib/api-client.ts`), and the `notes` clear path (sending an explicit `null`) is already
the null-aware `lib/` layer's job — **no new API route, lib helper, or migration is needed**;
`notes` already lives on `items`.

### 2. Modal: replace the read-only Notes block with an editor

In `DetailBody` (`story-detail-modal.tsx`), turn the static Notes block into a click-to-edit area,
mirroring `EpicHeaderActions` (`board.tsx`) so the two notes editors feel identical:

- **Display mode:** the current notes as `whitespace-pre-wrap` text, or an **"Add notes…"**
  affordance (muted) when empty. A `Pencil` affordance (already imported in the modal) reveals on
  hover, like the title and epic-notes editors. Clicking enters edit mode with the draft seeded
  from `story.notes ?? ''`.
- **Edit mode:** a `textarea` (reuse the block-reason / epic-notes textarea styling already in this
  file and in `board.tsx`) with **Save** and **Cancel** buttons. `aria-label="Edit notes"`.
- **Save:** trim the draft; if it equals the current notes, no-op out of edit mode; otherwise call
  `updateStoryNotes(itemId, next === '' ? null : next)` (empty → `null`, matching the epic-notes
  and "send `null` for clears" conventions). On the store's rejection, reset the draft to the
  current notes (the store already rolled the value back).
- **Cancel / Escape:** exit edit mode and reset the draft to `story.notes ?? ''` without writing.
- Guard on a null `item_id` exactly as `EditableTitle` guards (the `v_code_stories` view type is
  all-nullable; a seeded story always has a real `item_id`).

Keep the existing `useCodeActions()` usage — the modal already reads it for `updateStoryTitle`.
Preserve the dark, dense aesthetic and existing tokens; no new dependencies.

### 3. Tests & demo

- **RTL** (`story-detail-modal.test.tsx`): editing notes shows the textarea, Save calls
  `updateStoryNotes` with the trimmed value (and `null` when cleared), Cancel/Escape reverts without
  calling it, and a rejected save restores the displayed notes. (The file already mocks the store
  actions for the title-edit tests — extend that harness.)
- **Storybook** (`story-detail-modal.stories.tsx`): the notes editor's edit state is covered by the
  existing modal snapshot(s); add/adjust a state if needed and follow the `storybook` capture →
  approve flow if a baseline moves.
- **Demo doc** (`docs/demos/ALF-40/…` via `npm run demo`): open a story, edit its notes, show the
  change persists on reopen.

## Acceptance criteria

- [ ] The Notes section of the story detail modal is click-to-edit (pencil affordance on hover),
      consistent with the title editor and the epic-notes editor.
- [ ] An empty-notes story shows an **"Add notes…"** affordance; entering and saving text persists
      it; saved notes render as `whitespace-pre-wrap`.
- [ ] Saving optimistically updates the displayed notes immediately, then reconciles with the
      server row; a failed save rolls the displayed notes back.
- [ ] Clearing the notes to empty saves `null` (notes become "Add notes…" again).
- [ ] Cancel and Escape exit edit mode without writing and without changing the displayed notes.
- [ ] Notes editing goes through a new optimistic `updateStoryNotes` store action that PATCHes the
      item via `api.updateItem(itemId, { notes })` — no new API route, lib helper, or migration.
- [ ] Tests cover the save (trimmed value + `null` clear), the no-op/cancel paths, and the
      rollback; `check` is green and the change is captured in a demo doc.

## Out of scope / open questions

- **Title editing** — already exists (`EditableTitle`); unchanged here.
- **Epic notes** — already editable on the board; unchanged.
- **Spec markdown** stays **read-only** in the modal — it's the Worker-owned snapshot
  (`code_items.spec_markdown`), not a generic notes field.
- **Inline notes editing on the board card** — out of scope; notes are edited only in the detail
  modal (consistent with how Project/Epic/Ref/state live on the board/modal, not inline).
- **No schema or read-path change** — `notes` already live on `items` and flow through
  `v_code_stories`; this ticket is purely a frontend editing affordance over existing data.
