# ALF-35 — Alfred: view all stories by priority

> **Status:** Refinement spec. Hand to an implementation session.
> **Module:** Software Factory (`code`). See
> [`docs/specs/code-module/code-module-spec.md`](code-module/code-module-spec.md) §4 (schema),
> §9 (board/swimlanes), §14 (data flow & stores). Touches the `code_items` schema +
> `v_code_stories` view (`database/migrations/`), the `CodeProvider` store
> (`frontend/lib/stores/code-store.tsx`), the Code routing/nav, and a new Backlog view.
> Read the `data-flow`, `motion`, `supabase`, and `react` skills first.

## Context / problem

The Code module today is **project-scoped**: you pick one project from the sidebar and see its
board — epics stacked vertically, each an expandable row of six happy-path swimlanes
(`frontend/components/code/board.tsx` → `epic-block.tsx` → `swimlane.tsx` → `story-card.tsx`).
There is **no cross-project view** and **no notion of priority**. Stories sort only by
`ref_number` (creation order) everywhere — `getCodeStories()` orders by `ref_number`
(`frontend/lib/data/code.ts`), `buildEpicBoard` lays each lane out in that same order
(`code-store.tsx`), and epics render oldest-first. So there is no way to answer the question the
owner actually has: **"across every project and epic, what should I work on next?"**

This ticket adds a **Backlog**: a single global, re-orderable, priority list of all outstanding
stories spanning every project and epic, and makes the per-project board **reflect that one
global priority order** (epics sorted by their best story; lanes sorted by priority). The result
is a birds-eye view of outstanding software work that the owner can rank, with the project boards
falling in line beneath it.

There is **no ordering column** on `code_items` today, so this needs a schema migration and a
types regeneration. Per the request, that is split into a **preliminary, supervised Phase A**
(migration + type regen, applied with live credentials) that gates the frontend work in **Phase
B**. This mirrors the credentialed-closeout pattern already used by the code module
(code-module-spec §4 / §16.1; ALF-41 §1).

### Resolved decisions (settled with the requester during refinement)

- **Backlog scope = outstanding only, with a toggle.** The Backlog hides `done` and `abandoned`
  stories by default (it answers "what's left to do"), with a **"Show completed"** toggle that
  reveals them — mirroring the board's existing *Show blocked* / *Show archived* toggles
  (`board.tsx`).
- **Backlog is the default Code view.** Opening the module at the bare `/code` renders the
  Backlog (not the old "pick a project" empty state). The landing's pretty hero ("The Software
  Factory" serif title + icon, `code-landing.tsx`) is **kept and folded in as the Backlog's
  header**, not discarded.
- **Reorder = neighbour swap via chevrons.** Up/down chevron buttons only (no drag yet). Chevron
  **up** swaps a story's priority with the visible neighbour **above** it; **down** with the one
  below. The transition is **animated**.
- **Priority is a single global total order** across all stories. The Backlog, the project board's
  epic order, and within-lane order all derive from this one column.

## Proposed change

### Phase A — Schema migration + type regen (preliminary, supervised, credentialed)

A separate, supervised step completed **before** Phase B. It needs live Supabase credentials a
web/CI sandbox lacks (`supabase db push`, `supabase gen types`), so an agent applies it locally,
verifies, then **edits this spec to mark Phase A complete** (the ☐ → ✅ block below), exactly as
ALF-41 §1 did.

**New migration `database/migrations/0005_story_priority.sql`:**

1. **A global priority sequence + column on `code_items`.** Priority is a *global* total order
   (the Backlog spans all projects), so use one Postgres sequence — not the per-project
   `next_code_ref`. Lower number = higher priority (rank 1 sorts to the top).

   ```sql
   -- A global story-priority order for the cross-project Backlog (ALF-35).
   -- Lower = higher priority. One sequence (NOT the per-project ref counter) because the
   -- Backlog ranks every story across every project in a single list. New stories append to
   -- the bottom (largest priority) until the owner ranks them up.
   create sequence code_priority_seq;

   alter table code_items
     add column priority bigint not null default nextval('code_priority_seq');

   comment on column code_items.priority is
     'Global cross-project Backlog rank (ALF-35). Lower = higher priority. Allocated from '
     'code_priority_seq; reordered by swap_code_priority(). Distinct across all stories.';
   ```

2. **Backfill existing rows deterministically**, then advance the sequence past the max so new
   inserts never collide with backfilled values. Seed by current board order (`ref_number`) so
   the first Backlog render matches what the owner sees today; they re-rank from there.

   ```sql
   -- Seed priority from existing creation order (ref_number) — a stable starting rank.
   with ranked as (
     select item_id, row_number() over (order by ref_number) as rn from code_items
   )
   update code_items c set priority = ranked.rn from ranked where ranked.item_id = c.item_id;

   -- Park the sequence above every backfilled value so appends land at the bottom.
   select setval('code_priority_seq', coalesce((select max(priority) from code_items), 0) + 1, false);

   create unique index code_items_priority_key on code_items (priority);
   ```

   - The `unique` index makes the order strict/deterministic and is what lets the swap RPC use a
     single atomic `CASE` update without a transient duplicate (below).
   - The existing creation RPCs (`enter_code_module`, `create_code_story`) insert into
     `code_items` **without** naming `priority`, so the column default (`nextval`) assigns it
     automatically — **no RPC edit needed** for appends.

3. **Atomic swap RPC.** A neighbour swap exchanges two rows' priorities in one statement (atomic;
   no transient duplicate that would trip the unique index). `security invoker` so RLS still
   applies, matching the 0002/0004 RPCs.

   ```sql
   -- Swap the global priority of two stories (the Backlog chevron reorder). One UPDATE so the
   -- unique(priority) index never sees a duplicate mid-swap. Returns both updated rows.
   create or replace function swap_code_priority(p_a text, p_b text)
   returns setof code_items language plpgsql security invoker as $$
   declare a_pri bigint; b_pri bigint;
   begin
     select priority into a_pri from code_items where ref = p_a;
     select priority into b_pri from code_items where ref = p_b;
     if a_pri is null or b_pri is null then
       raise exception 'swap_code_priority: unknown ref (% / %)', p_a, p_b;
     end if;
     return query
       update code_items
          set priority = case ref when p_a then b_pri when p_b then a_pri else priority end
        where ref in (p_a, p_b)
       returning *;
   end; $$;

   grant execute on function swap_code_priority(text, text)
     to anon, authenticated, service_role;
   ```

4. **Expose `priority` on the board view.** Recreate `v_code_stories` (defined in 0002) to add
   the column so the client can sort by it. `create or replace view` only allows **appending**
   columns, so add `c.priority` at the end of the select list.

   ```sql
   create or replace view v_code_stories with (security_invoker = true) as
     select
       c.item_id, c.project_id, c.epic_id, c.ref_number, c.ref, c.factory_state, c.lane,
       c.spec_path, c.spec_sha, c.spec_markdown, c.refinement_pr_url, c.implementation_pr_url,
       c.blocked_reason, c.created_at as code_created_at, c.updated_at as code_updated_at,
       i.title, i.notes, i.source_url, i.created_at as item_created_at,
       p.key as project_key, p.name as project_name, p.repo_owner, p.repo_name,
       e.name as epic_name, e.ref as epic_ref, e.archived_at as epic_archived_at,
       c.priority                              -- ← ALF-35: appended for Backlog ordering
     from code_items c
     join items i on i.id = c.item_id
     join projects p on p.id = c.project_id
     join epics e on e.id = c.epic_id;
   ```

**Type regen.** Adding the column + view column changes the generated Supabase types. Regenerate
`frontend/lib/database.types.ts` with `supabase gen types` and commit the **raw** output (it is a
generated file — never hand-edit; see CLAUDE.md "Generated files"). After regen, `CodeStory` and
`CodeItem` gain `priority` with no `lib/types.ts` change (those are aliases over the generated
types).

> **✅ Phase A applied 2026-06-23.** Migration `0005_story_priority.sql` run against the live
> Supabase project (`pobfpuohktigmnkcqwga`) via the session pooler. Results: `code_priority_seq`
> created; `priority bigint not null default nextval('code_priority_seq')` added to `code_items`;
> 41 existing rows backfilled 1–41 (by `ref_number` order); sequence advanced to 42 so new inserts
> append at the bottom; `code_items_priority_key` unique index created; `swap_code_priority(text,
> text)` RPC created (security invoker, grants to anon/authenticated/service_role); `v_code_stories`
> recreated with `c.priority` appended as the final column. `frontend/lib/database.types.ts`
> regenerated with `npx supabase@2.95.0 gen types typescript --db-url` (Docker-backed, token-free);
> `priority` present as `number` on `code_items` Row and as `number | null` on `v_code_stories` Row
> (view columns are always nullable in generated types).

### Phase B — Frontend

Phase B assumes Phase A has landed (the regenerated types expose `priority`).

#### 1. Store: priority in the projection, a reorder action, priority-aware derivations

In `frontend/lib/stores/code-store.tsx`:

- **`codeItemToStoryPatch`** — add `priority: row.priority` so the optimistic reconcile *and* the
  existing realtime `patchStory` (ALF-41) both carry priority through the single sidecar→story
  projection.
- **New action `reorderStory(ref, neighbourRef)`** on `CodeActions` — swap two stories' global
  priority, optimistic + reconcile/rollback (the `runOptimisticMutation` recipe). The **view**
  computes which neighbour (it owns the filter/sort state), so the action just swaps the two refs
  it is handed:
  - Optimistic: `patchStory` both stories with each other's `priority` (find both in
    `stateRef.current.stories`; capture the prior pair for rollback).
  - `apiCall`: `api.reorderCode(ref, neighbourRef)`.
  - Reconcile: apply each returned `code_items` row via `codeItemToStoryPatch` (`patchStory`).
  - Rollback: restore the captured prior priorities.
- **`useProjectBoard` ordering (priority-driven).** Today it filters epics by project and groups
  stories with `buildEpicBoard` in fetch order. Change the derivations so the board reflects the
  global priority:
  - **Within a lane / escape bucket:** sort stories by `priority` ascending (lowest number first).
  - **Epic order:** sort `activeEpics` (and `archivedEpics`) by each epic's **best** story —
    `min(priority)` across that epic's stories. Epics with no stories sort **last**, falling back
    to `created_at` ascending for a stable tie-break. ("The epic with the highest-ranked story is
    up first.")
- **New selector `useBacklog(opts: { showCompleted: boolean })`** — the flat, ranked,
  cross-project list for the Backlog view. Returns all stories sorted by `priority` ascending,
  **filtered** to outstanding states (everything except `done` and `abandoned`) unless
  `showCompleted` is true. Memoized on the stories slice + the flag, like `useProjectBoard`.

> The action objects stay memoized with `[]` deps (the deliberate, Stryker-annotated stability
> invariant); `reorderStory` reads `stateRef.current` like the existing actions, so it adds no dep.

#### 2. API: the reorder endpoint

- **Schema** (`frontend/lib/api/schemas.ts`): `reorderCodeSchema = z.object({ a: refString, b:
  refString })` where both are non-empty story refs (not UUIDs — refs are the code module's keying
  convention, as `PATCH /api/code/[ref]` already documents). Reject `a === b`.
- **Route** `frontend/app/api/code/reorder/route.ts` — `POST`, `withSession`, parse with the
  schema, call the `swap_code_priority(a, b)` RPC, map errors with `mapSupabaseError`, return the
  two updated rows (`jsonOk({ rows })`). A single atomic RPC (not two `PATCH`es) so the
  `unique(priority)` index is never transiently violated and a partial failure can't leave one
  story re-ranked.
- **api-client** (`frontend/lib/api-client.ts`): `reorderCode(a: string, b: string):
  Promise<CodeItem[]>` posting to `/api/code/reorder`.

#### 3. Routing & nav: Backlog as the default Code view

- **`code-view.tsx`** — the URL→view deriver. Today: `/code/<tail>` → `Board` for `tail`, bare
  `/code` → `CodeLanding`. Change to:
  - bare `/code` **or** `/code/backlog` → `<Backlog />` (the new default).
  - `/code/<projectId>` → `<Board projectId>` (unchanged).
  - Guard the literal `backlog` segment so it is **not** treated as a project id (it isn't a
    UUID, so today it would render "This project could not be found").
- **Add `frontend/app/(shell)/(code)/code/backlog/page.tsx`** rendering `<ModuleRouter />` (same
  one-liner as the other code pages), so `/code/backlog` is a real, precedence-winning static
  route that hard-loads/deep-links server-side. (A static segment wins over the sibling
  `[project-id]` dynamic route in the App Router.)
- **`project-nav.tsx`** — add a **Backlog** `ViewLink` to `/code/backlog` **above** the
  "Projects" header/list, with a fitting lucide icon (e.g. `ListOrdered`), highlighted via
  `navLinkClass` when the active path is the Backlog (`pathname === '/code' || pathname ===
  '/code/backlog'`). Forward `onClose` like the project links (mobile drawer).

#### 4. The Backlog view

New `frontend/components/code/backlog.tsx` (`Backlog`), composed from existing primitives:

- **Header (the repurposed hero).** Keep the landing's pretty treatment — the `GitBranch` badge,
  the `font-serif text-2xl` "The Software Factory" title — as a header band atop the list, with
  copy updated from "Pick a project…" to describe the Backlog (e.g. "Every story across your
  projects, ranked by priority."). Extract the reusable hero out of `code-landing.tsx` (or inline
  it here and retire `CodeLanding`, since the Backlog is now the default `/code`). A **"Show
  completed"** `ToggleButton` (reuse `@/components/atoms/toggle-button`, as the board does) lives
  in the header, driving `useBacklog({ showCompleted })` via local state.
- **The list — one row per story, single column.** `useBacklog(...)` gives the ranked list; render
  each as a `BacklogRow`. Empty state: a muted message guiding the owner to send stories into the
  Code module (echoing the board's empty copy).
- **`BacklogRow`** (`frontend/components/code/backlog/backlog-row.tsx`):
  - **Body = a link to the story's modal in its project board.** A `ViewLink` (client-side
    history push, instant) to `` `/code/${story.project_id}?story=${story.ref}` `` — see §5. The
    body shows: the **ref** (`font-mono text-accent-teal`, like `story-card.tsx`), the **title**,
    a **project badge** and an **epic badge** (the `Badge` atom — e.g. project `accent`/teal
    showing `project_name` or `project_key`; epic `muted`/`secondary` showing `epic_name` +
    `epic_ref`), and a **status badge for the story's current factory state** — labelled for
    **every** state, not just the escape ones: *Needs Refinement / In Refinement / Ready for Dev
    / In Development / Ready for Review / Done / Blocked / Abandoned*. Reuse the detail modal's
    full-state chip (`story-detail-modal.tsx`'s `StateChip`, driven by `FACTORY_STATE_LABELS`
    from `code-store.tsx`, with the `accent` / `alert` (blocked) / `destructive` (abandoned)
    variants), **not** `story-card`'s chip — that one only renders for blocked/abandoned, whereas
    the Backlog must show the status on every row. Factor `StateChip` into a shared atom if it
    isn't already importable, so the Backlog and the modal share one definition.
  - **Reorder controls = two chevron `IconButton`s** (`ChevronUp` / `ChevronDown`), separate from
    the link body (no nested interactive elements; mirror how `story-card` separates the
    clickable body from its launch buttons). Up calls `reorderStory(story.ref, prevVisibleRef)`;
    down calls `reorderStory(story.ref, nextVisibleRef)`, where prev/next are the neighbours **in
    the currently rendered (filtered) list** (the Backlog computes them and passes them, or
    passes a disabled flag at the ends). The **first** visible row's Up and the **last** visible
    row's Down are `disabled`. Labels: `Move <ref> up` / `Move <ref> down` (accessible names;
    keyboard-operable).

#### 5. Click-through: open the story's modal in the project board

A Backlog row navigates to the story's board with the detail modal open. The board opens its modal
from **local `openStoryId` state** today; make it also honour a URL param so a cross-view link can
open it:

- **`board.tsx`** — read a `story` search param (`useSearchParams().get('story')`, a **ref**). On
  mount / when the param changes, resolve it to the matching board story and set `openStoryId`
  (the board already resolves `openStory` from its `allStories` by `item_id`; resolve the param's
  ref → that story). If the ref isn't in this project, ignore it.
- **Clearing it.** When the modal closes (`onOpenChange(false)`), clear the `?story=` param with a
  `history.replaceState` to a clean `/code/<projectId>` so it doesn't re-open on the next render
  and the URL stays tidy. (Replace, not push — closing the modal shouldn't add history.)
- This keeps the board's existing state-driven modal; the param is just an **entry seam** for
  deep-linking from the Backlog (and is shareable/reload-safe as a bonus).

#### 6. Animate the reorder (FLIP)

The list reorders by swapping `priority`, which re-sorts the rows — a DOM sibling reorder, which
CSS can't transition on its own (and there is **no Framer Motion** in the stack; the `motion`
skill: "CSS animations + transitions cover alfred's restrained motion"). Use a small, reusable
**FLIP** hook:

- New `frontend/lib/hooks/use-flip-list.ts` (`useFlipList`): keyed by `item_id`, in a
  `useLayoutEffect` it (First) reads each tracked row's `getBoundingClientRect` from the previous
  render, (Last) reads the new rects, (Invert) sets `transform: translateY(Δ)` with no transition,
  then (Play) on the next frame clears the transform under a short `transition-transform`
  (~200ms ease-out, matching the motion skill's durations). Rows expose a ref via a registrar the
  hook returns.
- **Respect reduced motion:** gate the whole effect on `usePrefersReducedMotion()`
  (`@/lib/use-prefers-reduced-motion`) — when reduced, skip the transform entirely (rows just
  snap). Pair any transition class with `motion-reduce:transition-none` (motion-skill rule).
- Record this as a **new reusable motion pattern** (see §8) — the library has expand/collapse and
  fade reveal/collapse, but no list-reorder FLIP yet.

#### 7. Tests (back-pressure: every behavior expressed in a test)

- **Unit (jest)** — `code-store.test.tsx`:
  - `codeItemToStoryPatch` now carries `priority`.
  - `reorderStory` optimistically swaps two stories' priorities, reconciles from the returned
    rows, and **rolls back** on API rejection (mock `api.reorderCode`).
  - `useProjectBoard`: epics order by `min(priority)` (no-story epics last, `created_at`
    tie-break); each lane and the escape bucket sort by `priority` ascending.
  - `useBacklog`: returns the global list sorted by priority; excludes `done`/`abandoned` when
    `showCompleted` is false and includes them when true.
- **RTL** (`backlog.test.tsx`, `backlog-row.test.tsx`, and a board test):
  - The Backlog renders rows in priority order, each with ref, title, project + epic badges, and
    a **status badge** showing the story's factory state (assert a happy-path label like "In
    Development" renders, not only the escape states); the header hero + "Show completed" toggle
    are present; toggling reveals done/abandoned.
  - Chevron **up** on the 2nd row calls `reorderStory` with the 1st row's ref (and re-sorts);
    the top row's Up and the bottom row's Down are disabled.
  - A row's body links to `/code/<projectId>?story=<ref>`; with that param set, the **board**
    opens the matching story's modal, and closing it clears the param.
- **Storybook** — a `Backlog` story (visual snapshot of the ranked list with badges/chips +
  header), and (optionally) a play function asserting a chevron click reorders. The FLIP transform
  itself isn't asserted in jsdom (no layout/transitions); cover its *presence* via the demo +, if
  a regression guard is wanted, the `debug-animations` skill (sample `transform` over frames in
  Playwright).
- **Playwright e2e** (`frontend` `check:slow`): open `/code` (Backlog is default), reorder a story
  with a chevron and assert the new order, then open a story's modal from a row and confirm it
  lands on the project board with the modal open.

#### 8. Demo doc + skill updates (compounding learning)

- **Demo doc** (`docs/demos/ALF-35/…`, `npm run demo`): show the Backlog (ranked list, badges,
  state chips, header), a chevron reorder (before/after screenshots — and, for the animation,
  either a `debug-animations` frame sample or a short note), the "Show completed" toggle, the
  click-through opening a story modal on its board, and the **project board re-ordering** (epic +
  lane order) after a Backlog re-rank. `npm run demo -- verify` before wrap-up. Add the live
  `pr-link` to the PR description.
- **Skills** (per the CLAUDE.md compounding-learning rule — read `compounding-learning` first):
  - `data-flow` skill: record the **global `priority` order**, the `reorderStory` swap action
    (optimistic swap + atomic RPC), and that the board's epic/lane order + the Backlog all derive
    from this one column.
  - `motion` skill: add the **FLIP list-reorder** pattern (`useFlipList`) — the first non-collapse,
    non-fade motion in the library — with the reduced-motion branch.
  - `supabase` skill: note the **global `code_priority_seq`** (vs the per-project `next_code_ref`),
    the **atomic swap via a single `CASE` UPDATE** under a `unique(priority)` index, and the
    `create or replace view` **append-only** column gotcha.

## Acceptance criteria

- [x] **Phase A (supervised):** migration `0005_story_priority.sql` adds a global `priority`
      (`code_priority_seq` default) to `code_items`, backfills existing rows, adds the
      `unique(priority)` index, the `swap_code_priority` RPC, and appends `priority` to
      `v_code_stories`; `frontend/lib/database.types.ts` is **regenerated** (not hand-edited). The
      Phase-A block in this spec is flipped to a dated ✅ once applied with live credentials.
- [ ] A **Backlog** view lists **every outstanding story across all projects and epics** in a
      single-column, priority-ordered list; each row shows the ref, title, an **epic badge**, a
      **project badge**, and a **status badge labelled for the story's current factory state**
      (In Refinement, In Development, Ready for Dev, … — for every state, not only Blocked/Abandoned).
- [ ] `done` and `abandoned` stories are **hidden by default**; a **"Show completed"** toggle in
      the Backlog header reveals them (and hides them again).
- [ ] **Backlog is the default Code view**: bare `/code` (and `/code/backlog`) render it; the old
      "pick a project" empty state is gone, and the landing's hero is **kept as the Backlog
      header**. A **Backlog** nav entry sits **above** the project list in the sidebar.
- [ ] Each row's body **links to that story's detail modal in its project board** (`/code/<projectId>?story=<ref>`):
      the board opens the matching story's modal, and closing it clears the param.
- [ ] **Chevron up/down** reorder a story by **swapping priority with its visible neighbour**; the
      change **persists** (atomic `swap_code_priority` RPC) and is **optimistic** (rolls back on
      API failure). The top row's Up and the bottom row's Down are disabled. The reorder is
      **animated** (FLIP), honouring `prefers-reduced-motion`.
- [ ] The **project board reflects the global priority**: epics are ordered by their
      highest-priority (lowest-number) story (no-story epics last); within every swimlane (and the
      off-track bucket) stories are ordered by priority.
- [ ] Tests cover the store (`reorderStory` swap/reconcile/rollback, `priority` in the projection,
      priority-driven `useProjectBoard`, filtered/sorted `useBacklog`), the Backlog UI (order,
      badges, chips, toggle, end-disabled chevrons, reorder), and the click-through→modal path;
      `check` is green and a demo doc captures the behaviour.
- [ ] The `data-flow`, `motion`, and `supabase` skills record the new priority/reorder/FLIP
      patterns.

## Out of scope / open questions

- **Drag-and-drop reorder.** Explicitly chevrons-only for now (the request says "just with
  chevron up/down buttons for now"); the board's swimlanes also remain non-drag (code-module-spec
  §9). A future ticket can add dnd-kit drag to the Backlog (the store would expose an
  insert-at-position move rather than a pairwise swap).
- **Reordering from the project board.** Chevrons live on the **Backlog** only; the board is
  read-ordered (it *reflects* priority, it doesn't set it). Per-board reordering is a possible
  future enhancement.
- **Cross-device realtime for priority.** ALF-41 subscribes the board to `code_items` `UPDATE`s,
  and a swap is an UPDATE, so a reorder on another device will already patch `priority` into an
  open tab via the existing `codeItemToStoryPatch` path — but verifying/animating that live
  reorder is **not** part of this ticket's scope (no new notification or realtime work here).
- **Epic-ordering nuance (flag, low-stakes).** Epic order uses `min(priority)` over **all** the
  epic's stories. If an epic's best-ranked story is `done`/`abandoned`, it still counts toward the
  epic's rank. Restricting the epic key to *outstanding* stories is a plausible refinement; left
  as a deferred decision unless it proves confusing in use.
- **Archived-epic stories in the Backlog.** The Backlog filters on a story's own `factory_state`,
  independent of whether its epic is archived — so an outstanding story under an archived epic
  still appears. (Its epic badge can indicate the archived state if desired.) Hiding
  archived-epic stories entirely is deferred.
- **Manual priority entry / numeric rank display.** No editable priority number, no "move to
  top/bottom", no rank column shown — only relative neighbour swaps. Add if the swap-only flow
  proves slow for large backlogs.
- **New-story initial rank.** New stories append to the **bottom** of the global order (largest
  `priority`, via the sequence default), to be triaged upward. Inserting new work at the top
  instead is a trivial future change (seed from a descending sequence) but not done here.
