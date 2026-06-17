# ALF-41 — Add ability to update story swimlanes in real-time on the frontend

> **Status:** Refinement spec. Hand to an implementation session.
> **Module:** Software Factory (`code`). See [`docs/specs/code-module/code-module-spec.md`](code-module/code-module-spec.md) §5 (lifecycle/state machine), §9 (board/swimlanes), §13 (the webhook Worker), and §14 (data flow & stores).

## Context / problem

In the Software Factory, the swimlane a story sits in is its **`factory_state`**, a column on the
`code_items` sidecar. The board (`frontend/components/code/board.tsx`) renders one row of swimlanes
per epic, and `useProjectBoard` (`frontend/lib/stores/code-store.tsx`) groups stories into lanes by
`factory_state`. The whole code dataset is fetched once in the `(code)` layout
(`frontend/app/(code)/layout.tsx` → `lib/data/code.ts`) and seeded into the `CodeProvider` store,
which is then **authoritative for the session** — per the `data-flow` skill, "seed once at the
layout; a hard reload re-seeds," and there is **no `router.refresh()`** after mutations.

That seed-once model works for the Tasks module because the only writer is the user in their own
browser (optimistic store actions). **The code module breaks that assumption.** A story's
`factory_state` is changed *out of band* by the **webhook Worker** (code-module-spec §13): when a
refinement PR merges the Worker writes `ready_for_dev`; when an implementation PR opens it writes
`ready_for_review`; on merge, `done`; etc. (§5.2 transition table). These writes never touch the
open browser tab's store, so:

- A user launches a Claude Code session from a card (state → `in_refinement`), watches the PR get
  created and merged, and **the card never leaves `In Refinement`** until they hard-reload or
  navigate out of and back into the Code view (the cross-group re-seed). The board silently lies
  about where work actually is.
- This is precisely the scenario the codebase deliberately deferred realtime for: the `supabase`
  skill ("What Was Deliberately Left Out") and the `data-flow` skill both say realtime was omitted
  because alfred is "single-user, one device at a time… add it then." The Worker is a **second,
  non-browser writer**, so "then" has arrived — for the code module specifically.

This ticket makes **story swimlanes update live**: a `factory_state` change written by the Worker
(or from another device/tab) moves the card to its new swimlane on an already-open board, with no
manual refresh.

## Proposed change

Subscribe the open Code board to **Supabase Realtime** `postgres_changes` on the `code_items`
table, and apply each change to the `CodeProvider` store via the existing reducer so
`useProjectBoard` re-groups the card into its new swimlane. Scope is the **code module only** — the
Tasks store is untouched.

### 1. Enable Realtime on `code_items` (migration)

Realtime delivers nothing until the table is in the `supabase_realtime` publication. Add a new
migration `database/migrations/0003_realtime_code_items.sql`:

```sql
-- Story swimlanes update live: stream code_items row changes to the open Code board.
-- factory_state is written out-of-band by the webhook Worker (0002 §13), so the browser
-- needs a push channel to reflect PR-driven transitions without a reload.
alter publication supabase_realtime add table code_items;
```

- RLS still governs Realtime reads: `code_items` already has the `authenticated full access`
  policy (`using (true)`) from `0002`, so an authenticated browser (anon key + session) receives
  changes; no new policy is needed.
- The publication change does **not** alter `frontend/lib/database.types.ts` — **no type
  regeneration** is required for this migration.
- **Sandbox limitation (same as code-module-spec §4):** applying the migration
  (`supabase db push`) needs live credentials a CI/web sandbox lacks. A sandbox session writes the
  migration file and the frontend code; **applying `0003` is a local, credentialed step** recorded
  in the closeout checklist (see Out of scope).

### 2. A pure mapper: `code_items` change → store patch

The board read shape is `CodeStory` (the flattened `v_code_stories` **view**); you cannot subscribe
to a view, so the channel listens to the **base `code_items` table** and its payload is a
`CodeItem` row. The sidecar fields a transition touches are exactly the ones `reconcileStory`
already maps (`frontend/lib/stores/code-store.tsx`). Factor that mapping into a small **pure,
exported, unit-tested** helper so both `reconcileStory` and the realtime path use one definition:

```ts
/** The sidecar fields a code_items row contributes to its flattened CodeStory. */
export function codeItemToStoryPatch(row: CodeItem): Partial<CodeStory> {
  return {
    ref: row.ref,
    ref_number: row.ref_number,
    factory_state: row.factory_state,
    lane: row.lane,
    spec_path: row.spec_path,
    spec_sha: row.spec_sha,
    spec_markdown: row.spec_markdown,
    refinement_pr_url: row.refinement_pr_url,
    implementation_pr_url: row.implementation_pr_url,
    blocked_reason: row.blocked_reason,
    code_created_at: row.created_at,
    code_updated_at: row.updated_at,
  };
}
```

Refactor `reconcileStory` to spread `codeItemToStoryPatch(saved)` over the optimistic row so there
is a single source of truth for the sidecar→story projection.

### 3. Subscribe inside `CodeProvider`

`CodeProvider` is already a client component holding the `dispatch`. Add a `useEffect` that opens a
Realtime channel and tears it down on unmount:

- Create a browser client with the existing `createClient()` from `frontend/lib/supabase/client.ts`
  (anon key + session; RLS applies). Build it **once** inside the effect (or memoized) so the
  subscription isn't recreated every render.
- `supabase.channel('code_items').on('postgres_changes', { event: 'UPDATE', schema: 'public',
  table: 'code_items' }, handler).subscribe()`; in cleanup call `supabase.removeChannel(channel)`.
- **Handler (UPDATE):** read `payload.new` as a `CodeItem`, then
  `dispatch({ type: 'patchStory', itemId: row.item_id, patch: codeItemToStoryPatch(row) })`. The
  reducer's `patchStory` is **keyed by `item_id` and a no-op when absent** (the documented race
  rule), so a change for a story not in the seeded set is harmlessly ignored, and a row that has
  since been removed is not resurrected.
- **No filter / fetch-all:** subscribe to every `code_items` UPDATE (single user, low volume) and
  let `patchStory` discard ones the store doesn't hold — consistent with the house "fetch-all then
  filter client-side" choice (`data-flow` skill). No per-project channel.

### 4. Interaction with optimistic writes (must not regress)

The store's own actions (`updateCodeState`, `openClaudeSession`) already patch optimistically, call
the API, and reconcile. A Realtime **echo** of the user's own write carries the same persisted
values, so re-applying `codeItemToStoryPatch` is **idempotent** — the card stays where the reconcile
already put it. A failed optimistic write rolls back locally and never reaches the DB, so no echo is
emitted. Therefore the subscription needs **no self-write filtering**; the existing optimistic
behavior is preserved unchanged. The detail modal (opened by `item_id`, `board.tsx`) re-reads the
live row, so an open modal reflects a realtime transition too.

### 5. Notify on a live transition (toast + tab title)

A swimlane move that happens *while the user watches* should announce itself — the user launched a
Claude session and is waiting for the PR to land, possibly on another tab. When a realtime UPDATE
**changes `factory_state`** (only then — ignore spec-markdown / PR-url-only updates), fire two
notifications from the same handler:

- **Toast.** Reuse the existing `useToastActions().showToast(message)` (`lib/stores/toast-store.tsx`,
  mounted in the shared `AppShell` that wraps `CodeProvider` — the same one the gate uses for
  "Created ALF-42"). Message: `` `${ref} moved to ${STATE_LABELS[next]}` `` for a happy-path state,
  or the escape-state label (Blocked / Abandoned) otherwise. **No new toast variant** — the existing
  transient, `aria-live` toast is enough.
- **Browser tab title.** When a transition arrives **while the tab is backgrounded**
  (`document.hidden`), prefix `document.title` with a marker so a glance at the tab strip shows
  something happened — e.g. `` `● ${ref} → ${STATE_LABELS[next]}` `` for the latest, or a rolling
  `` `(${n}) updates · …` `` count if several land while hidden. Restore the original title on the
  next `visibilitychange` to visible (or window `focus`). Capture the pre-existing title once so the
  restore is exact and this doesn't fight any route-level title.

**Fire only for real, external transitions.** Compute the previous state from
`stateRef.current.stories` **before** dispatching the patch; notify only when
`previous.factory_state !== row.factory_state`. This naturally **dedupes the user's own writes**: an
optimistic action already set the new state in the store before the echo arrives, so
`previous === next` and neither the toast nor the title fires for self-writes — exactly the same
idempotent-echo reasoning as §4. `CodeProvider` can read `useToastActions()` directly (it renders
inside `AppShell`/`ToastProvider`).

### 6. Tests & demo

- **Unit (jest)** — `code-store.test.tsx`: `codeItemToStoryPatch` maps every sidecar field; feeding
  a simulated UPDATE payload through the handler dispatches a `patchStory` that moves a story to its
  new `factory_state` lane (assert via `useProjectBoard`/`codeReducer`); a payload for an unknown /
  removed `item_id` is a no-op; an echo of an existing value leaves the store unchanged. Mock
  `@/lib/supabase/client` so the channel's `.on`/`.subscribe` capture the handler the test invokes
  (no live Realtime).
- **RTL** — render the board within a `CodeProvider`, capture the subscribed handler from the mocked
  client, emit an UPDATE moving a seeded story from `In Refinement` → `Ready for Dev`, and assert the
  card now renders under the `Ready for Dev` swimlane without any user interaction or refresh.
- **Notifications (RTL/jest)** — a state-changing UPDATE calls `showToast` with the
  `"<ref> moved to <label>"` message; a non-state UPDATE (e.g. only `spec_markdown`) and an echo of
  the current state do **not**; with `document.hidden` mocked true the `document.title` gains the
  marker and is restored on `visibilitychange`/`focus`. Mock the toast actions (as existing tests
  do) and `document.hidden`.
- **No Playwright e2e:** end-to-end Realtime needs a live Supabase project (the §1 sandbox
  limitation) and a real second writer; the behavior is covered deterministically by the unit/RTL
  tests against a mocked channel, mirroring how the Worker's transitions are unit-tested rather than
  e2e (code-module-spec §15).
- **Demo doc** (`docs/demos/ALF-41/…`, `npm run demo`): with the board open, drive a `factory_state`
  change from a **second** writer — e.g. `PATCH /api/code/:ref`, or a signed sample `pull_request`
  payload to the Worker as in the M7 demo — and show the card move swimlanes live. Because Realtime
  needs the credentialed Supabase project, note this as a local/high-touch capture step.

### 7. Record the decision in the skill library

This reverses the explicit "realtime deliberately left out" notes. As part of the change (per the
CLAUDE.md compounding-learning rule), update both:

- `.claude/skills/supabase/SKILL.md` ("What Was Deliberately Left Out") and
  `.claude/skills/data-flow/SKILL.md` ("What's Deliberately Left Out") — note that the **code module
  subscribes to `code_items` Realtime** because the webhook Worker is a non-browser writer, while
  Tasks/Folders remain seed-once. Capture the view-vs-base-table gotcha (subscribe to `code_items`,
  not `v_code_stories`) and the idempotent-echo reasoning.

## Acceptance criteria

- [ ] Migration `0003_realtime_code_items.sql` adds `code_items` to the `supabase_realtime`
      publication; no `database.types.ts` regeneration is needed.
- [ ] A `factory_state` change to a `code_items` row written **outside the open tab** (the Worker,
      another device, or a direct API PATCH) moves the corresponding card to its new swimlane on an
      already-open board **without a manual refresh or navigation**.
- [ ] The realtime payload (a `code_items` row) is applied through a pure, exported
      `codeItemToStoryPatch` helper and the reducer's existing `patchStory`; `reconcileStory` is
      refactored to reuse the same helper (one sidecar→story projection).
- [ ] The subscription lives in `CodeProvider`, uses the existing browser `createClient()`, and is
      torn down on unmount (`removeChannel`); it is created once, not per render.
- [ ] A change for an `item_id` not in the store, or for a since-removed story, is a no-op (no
      resurrection, no error). An echo of the user's own optimistic write leaves the board stable
      (no flicker / no regression to the optimistic + reconcile/rollback behavior).
- [ ] A realtime UPDATE that **changes `factory_state`** fires a toast (`"<ref> moved to <label>"`,
      via the existing `showToast`) and, when the tab is backgrounded, marks the browser tab title;
      the title is restored when the tab regains focus. Non-state updates and self-write echoes fire
      neither.
- [ ] Tests cover the mapper, a live swimlane move via a simulated UPDATE, the unknown-id no-op, the
      idempotent echo, and the toast + tab-title notifications; `check` is green and the change is
      captured in a demo doc.
- [ ] The `supabase` and `data-flow` skills' "left out" notes are updated to record that the code
      module now uses Realtime (with the view-vs-base-table and idempotent-echo gotchas).

## Out of scope / open questions

- **INSERT / DELETE of `code_items` from another device.** A new story created elsewhere can't be
  rendered from a `code_items`-only payload (the card needs the `items`/`projects`/`epics` joins in
  `v_code_stories`), and deletions are not part of the factory lifecycle. This ticket covers
  **UPDATE** (the swimlane move), which is the only transition the Worker performs. Live add/remove
  across devices is a future enhancement (it would need either an enriched broadcast or a targeted
  refetch on INSERT).
- **Realtime for `epics` / `projects`** (live rename, archive, new project from another device) —
  out of scope; only `code_items` (the swimlane driver) is subscribed here.
- **Tasks / Folders Realtime.** Unchanged — those have a single browser writer and stay seed-once
  (`data-flow` skill). This ticket does not generalize realtime across the app.
- **Drag-to-move between swimlanes.** Still out of scope (code-module-spec §9.2); swimlanes remain
  read-only — this ticket only makes externally-written state changes *appear* live.
- **Notification depth.** The toast + tab-title marker are the whole notification surface here — no
  OS/browser push notifications, no per-story notification preferences, no notification history, and
  no sound. (code-module-spec §11.3 mentions browser notifications as a separate "good-enough live
  monitoring" idea; that's not built here.) The tab-title marker reuses `document.title`; a richer
  unread-badge/favicon treatment is a future enhancement.
- **Credentialed closeout (local/high-touch).** Applying `0003` (`supabase db push`) and verifying
  end-to-end against the live project + Worker cannot be done in a web/CI sandbox (no `.env.local`);
  leave them as an explicit checklist for a local session, per code-module-spec §4 / §16.1 Phase C.
- **Open question (flag, don't block):** confirm the project's Realtime quota/settings are enabled
  in the Supabase dashboard (Realtime is on by default for new projects, but the publication must
  include the table — handled by `0003`).
