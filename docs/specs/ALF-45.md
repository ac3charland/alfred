# ALF-45 — Add ability to set up recurring tasks

> **Status:** Refinement spec. Hand to an implementation session.
> **Module:** Tasks (shared `items` model). Touches the schema (`database/`), the
> generated types, the API route layer (`frontend/app/api/**`, `frontend/lib/api/schemas.ts`),
> the optimistic tasks store (`frontend/lib/stores/tasks-store.tsx`), and the task UI
> (`frontend/components/tasks/**`, `frontend/components/atoms/**`).
> See the `data-flow` skill (optimistic + reconcile/rollback), the `supabase` skill
> (migrations, RLS, RPCs, type regen), and the `jest` skill (the recurrence engine is
> heavily unit-tested per the ticket).

> **Phase 0 (migration) status:** ⏳ **NOT YET RUN.** The schema migration + type
> regeneration below must be applied in a **supervised** session *before* any feature
> code is merged. When that session completes, it updates this line to **✅ DONE
> (migration `00NN_recurring_tasks.sql`, types regenerated)** and checks off the Phase 0
> acceptance criteria — that is the signal the rest of the work may proceed. See
> [Phase 0](#phase-0--schema--types-supervised) and the ticket's instruction to record
> migration completion back into this spec.

---

## Context / problem

alfred tasks today are one-shot: a task has a nullable `due_date`, and completing it
(`POST /api/tasks/[id]/complete` → the `complete_subtree` RPC) marks the task and its
subtree `completed` and hides them from the default views (SPEC §3.6). There is no way to
say "this happens every week" — the owner has to re-create a recurring obligation by hand
each time, which is exactly the kind of friction alfred exists to remove (SPEC §1).

ALF-45 adds **recurring tasks**, replicating the Apple Reminders recurrence UX shown in
the two reference screenshots on the ticket:

1. **A preset frequency menu:** `Never`, `Hourly`, `Daily`, `Weekdays`, `Weekends`,
   `Weekly`, `Biweekly`, `Monthly`, `Every 3 Months`, `Every 6 Months`, `Yearly`,
   `Custom…`.
2. **A custom editor:** a `Frequency` select (Daily / Weekly / Monthly / Yearly), an
   `Every N <unit>` interval stepper, and a weekly day-of-week selector
   (`S M T W T F S`), plus the Monthly / Yearly variants of the full Apple editor and an
   **End Repeat** control.

The ticket flags this as edge-case-heavy and asks that the recurrence math be
**exhaustively unit-tested**. Accordingly the design isolates all date arithmetic in a
**pure, framework-free TypeScript engine** (`frontend/lib/recurrence/`) that can be tested
in Jest without rendering anything or touching the DB.

### Resolved product decisions (confirmed with the owner during refinement)

| Decision | Choice |
|---|---|
| **Completion model** | **Spawn the next occurrence.** Completing a recurring task marks the current task `completed` (kept in the Completed view as history) and inserts a **new active task** with the next due date. |
| **Custom editor scope** | **Full Apple custom** — Daily / Weekly (day-of-week) / Monthly (on day N *or* on the [first…last] [weekday]) / Yearly (month + day), each with an `Every N` interval. |
| **End condition** | **Included** — `End Repeat`: `Never` / `On Date` / `After N occurrences`. |
| **Which tasks may recur** | **Top-level tasks only** (`parent_id IS NULL`). The repeat control is hidden on subtask rows. |

---

## Proposed change

### 1. Recurrence rule model (the shared shape)

Recurrence is described by a single structured rule, modeled on the iCal RRULE subset Apple
exposes. Define it once as a TypeScript type in `frontend/lib/recurrence/types.ts` and a
matching Zod schema in `frontend/lib/api/schemas.ts`:

```ts
type RecurrenceFreq = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly';
type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday … 6 = Saturday
type MonthlyMode =
  | { kind: 'day_of_month' }                 // e.g. the 15th (from the anchor date)
  | { kind: 'positional'; setpos: 1 | 2 | 3 | 4 | 5 | -1; weekday: Weekday }; // "first Monday" … "last Friday"

type RecurrenceEnd =
  | { type: 'never' }
  | { type: 'on_date'; until: string }       // inclusive ISO date — stop once next due > until
  | { type: 'after'; count: number };        // total occurrences across the series (count >= 1)

interface RecurrenceRule {
  freq: RecurrenceFreq;
  interval: number;                          // "every N", >= 1
  byweekday?: Weekday[];                      // weekly only; non-empty when present
  monthly?: MonthlyMode;                      // monthly only
  end: RecurrenceEnd;
}
```

The preset menu maps onto this rule (so presets and Custom share one persisted shape — the
menu is just a friendlier front-end for common rules):

| Preset | Rule |
|---|---|
| Never | *(no rule — `recurrence = null`)* |
| Hourly | `{ freq: 'hourly', interval: 1 }` |
| Daily | `{ freq: 'daily', interval: 1 }` |
| Weekdays | `{ freq: 'weekly', interval: 1, byweekday: [1,2,3,4,5] }` |
| Weekends | `{ freq: 'weekly', interval: 1, byweekday: [0,6] }` |
| Weekly | `{ freq: 'weekly', interval: 1, byweekday: [<anchor weekday>] }` |
| Biweekly | `{ freq: 'weekly', interval: 2, byweekday: [<anchor weekday>] }` |
| Monthly | `{ freq: 'monthly', interval: 1, monthly: { kind: 'day_of_month' } }` |
| Every 3 Months | `{ freq: 'monthly', interval: 3, monthly: { kind: 'day_of_month' } }` |
| Every 6 Months | `{ freq: 'monthly', interval: 6, monthly: { kind: 'day_of_month' } }` |
| Yearly | `{ freq: 'yearly', interval: 1 }` |

(All presets carry `end: { type: 'never' }`. Opening **Custom…** from a preset pre-fills the
editor from the equivalent rule so the menu and editor are two views of the same value.)

### 2. The pure recurrence engine (`frontend/lib/recurrence/`) — the unit-test core

A framework-free module, the heart of the "unit-test the shit out of this" requirement.
No React, no DB, no `Date.now()` baked in (pass `now`/anchor in). Exports:

- **`nextOccurrence(rule, currentDue, occurrenceIndex): string | null`** — given the rule,
  the current occurrence's due date (ISO), and its 1-based index in the series, return the
  **next** due date (ISO), or `null` when the series has ended (end condition reached).
  This is the function that gets the exhaustive test matrix.
- **`summarizeRule(rule): string`** — a human label for the row chip / trigger
  (e.g. `"Every 2 weeks on Mon, Wed"`, `"Monthly on the last Friday"`, `"Yearly"`,
  `"Daily until Aug 1"`).
- **`ruleFromPreset(preset, anchorDate)` / `presetForRule(rule)`** — map between the preset
  menu and the rule (the latter returns `'custom'` when no preset matches, so the menu can
  show a Custom checkmark).

**Date-arithmetic rules to implement and test** (these are the edge cases):

- **Hourly:** `currentDue + interval` hours. Requires a *time-of-day* anchor — see the
  Hourly note under [Open questions](#out-of-scope--open-questions).
- **Daily:** `currentDue + interval` days.
- **Weekly (with `byweekday`):** advance to the **next selected weekday strictly after**
  `currentDue`; when the selected days for the current week are exhausted, jump
  `interval` weeks forward to that week's first selected weekday. (Weekdays/Weekends/Weekly/
  Biweekly all flow through this path.)
- **Monthly `day_of_month`:** same day-of-month, `interval` months later. **Clamp** a
  day that overflows the target month to that month's **last day** (Jan 31 + 1 month →
  Feb 28/29). Apple clamps; match it.
- **Monthly `positional`:** the Nth (`setpos` 1–5, or `-1` = last) `weekday` of the target
  month, `interval` months later. When `setpos` is 5 and the month has only four of that
  weekday, **skip to the next eligible month** (do not silently fall back to the 4th).
- **Yearly:** same month + day, `interval` years later. **Feb 29 → Feb 28** in non-leap
  years (clamp).
- **End conditions:** `never` → always returns a date. `on_date` → return the computed date
  unless it is **strictly after** `until`, in which case `null`. `after` → return `null`
  once `occurrenceIndex >= count` (the count-th occurrence is the last, so no successor).
- **DST / timezone:** due dates are calendar dates handled the same way `lib/date-utils.ts`
  already parses them (local-midnight, no UTC shift); reuse that convention. Day arithmetic
  must not drift across DST boundaries.

### 3. Persistence (Phase 0 — schema + types)

Recurrence is task-specific metadata. Add to the `items` table (nullable; absent for
non-recurring items and for non-task types):

- **`recurrence jsonb`** — the `RecurrenceRule` above, or `NULL` for a one-shot task.
  (JSONB rather than a column-per-field: we never query *by* a rule's internals — the engine
  reads it at completion time — and JSONB keeps the rule atomic and evolvable. Validate its
  shape with Zod at the API boundary, the project's existing pattern.)
- **`recurrence_series_id uuid`** — groups every occurrence of one recurring task (the
  original sets it to a fresh UUID; each spawned occurrence inherits it). Lets the Completed
  view and future "edit this and future" group the lineage.
- **`occurrence_index int`** — 1-based position of this occurrence within its series
  (the original = 1; each spawn increments). Drives the `after N` end condition.

Index `recurrence_series_id`. RLS/grants follow the existing `items` pattern verbatim
(`authenticated full access`; explicit `grant` for `service_role`) — see
`database/migrations/0001_initial_schema.sql`.

**Atomic complete-and-spawn RPC.** The next-date math lives in TypeScript (engine above),
so the API route computes the next due date and passes it in; the DB just performs the
two writes atomically. Add an RPC (e.g. `complete_and_spawn(root_id uuid, next_due
timestamptz, next_index int)`) that, in one transaction:
1. `complete_subtree(root_id)` (reuse the existing cascade), then
2. inserts a **new active occurrence**: a copy of the recurring task's own fields
   (`title`, `notes`, `source_url`, `folder_id`, `item_type`, `recurrence`,
   `recurrence_series_id`) with `status = 'active'`, `completed_at = NULL`,
   `due_date = next_due`, `occurrence_index = next_index`, **and a fresh deep copy of the
   task's active subtree** reset to `active` (new ids, same nesting, recurrence cleared on
   the children — children never recur). Returns the completed rows **and** the new
   occurrence root so the client can reconcile.

When the engine returns `null` (series ended), the route **does not** call the spawning
RPC — it falls back to the plain `complete_subtree` path (the last occurrence just
completes, nothing new appears).

Regenerate `frontend/lib/database.types.ts` with `supabase gen types` and commit the raw
output (never hand-edit — see CLAUDE.md / the `supabase` skill).

### 4. API + store wiring

- **`frontend/lib/api/schemas.ts`:** add a `recurrenceSchema` (Zod mirror of
  `RecurrenceRule`, with the cross-field refinements: `byweekday` non-empty & weekly-only,
  `monthly` monthly-only, `interval >= 1`, `count >= 1`, `until` a valid ISO date). Add
  `recurrence: recurrenceSchema.nullable().optional()` to **`createItemSchema`** and
  **`updateItemSchema`** (nullable so a PATCH can clear it).
- **`PATCH /api/items/[id]`** persists `recurrence` like any other field. **Setting a rule
  requires an anchor due date:** if the task has no `due_date`, the UI sets one first
  (default **today**); clearing `due_date` also clears `recurrence`. (Enforced primarily in
  the UI; the route accepts whatever it's sent.)
- **`POST /api/tasks/[id]/complete`** becomes recurrence-aware: load the task; if it has a
  `recurrence` and is top-level, compute `next = nextOccurrence(rule, due, index)`. If
  `next` is non-null, call `complete_and_spawn(id, next, index + 1)` and return
  `{ completed: Item[], spawned: Item }`; otherwise call the existing `complete_subtree` and
  return the completed rows as today. Keep the response shape backward-compatible for the
  non-recurring path.
- **`frontend/lib/api-client.ts`:** `completeTask` return type widens to surface the
  optional `spawned` occurrence.
- **`frontend/lib/stores/tasks-store.tsx`:** `completeTask` reconciles the spawned row —
  optimistically it can compute the next occurrence with the **same engine** (shared code,
  so the optimistic and server results agree) to insert the new active task immediately,
  then reconcile with the server's authoritative row; on error, roll back per the existing
  optimistic pattern (`data-flow` skill).

### 5. UI

In the inline meta panel (`frontend/components/tasks/task-row/task-meta-panel.tsx`), beside
the existing **Due date** field and **only for top-level `task` rows**, add a **Repeat**
control:

- **Trigger** shows the current rule via `summarizeRule` (or `"Never"` when none), styled
  like the existing inline-edit triggers.
- **Preset menu** (screenshot 1): a dropdown listing the presets above, with a checkmark on
  the active one (`presetForRule`), and **`Custom…`** at the bottom.
- **Custom editor** (screenshot 2): opens from `Custom…` (a popover/modal built on the
  existing shadcn/Radix primitives — see the `shadcn-ui` skill). Contents:
  - `Frequency` select: Daily / Weekly / Monthly / Yearly.
  - `Every [N] <unit>` numeric stepper (`unit` pluralizes with the frequency).
  - **Weekly:** the `S M T W T F S` toggle row (multi-select; at least one required).
  - **Monthly:** a toggle between *On day N* and *On the [first…last] [weekday]*.
  - **Yearly:** month + day (defaults from the anchor date).
  - **End Repeat:** `Never` / `On Date` (date picker) / `After [N] occurrences`.
  - `Cancel` / `OK` (OK writes the rule via the store).
- **Row affordance:** a recurring task shows a small **repeat icon/chip** on its row
  (alongside the existing `due-date-chip` atom) so recurrence is visible without expanding.
  Add it as a new atom (e.g. `components/atoms/recurrence-chip.tsx`) for reuse/snapshotting.

Respect `prefers-reduced-motion` and the dark/glow design language (SPEC §5.4); keyboard
operable; the day-of-week toggles and steppers are labeled for a11y (the `tailwindcss` /
`motion` skills).

---

## Acceptance criteria

### Phase 0 — schema & types (supervised)
- [ ] Migration adds `items.recurrence jsonb`, `items.recurrence_series_id uuid`,
      `items.occurrence_index int` (nullable/defaulted appropriately), an index on
      `recurrence_series_id`, and RLS/grants matching the existing `items` pattern.
- [ ] `complete_and_spawn` RPC exists, completes the subtree and inserts the next
      occurrence (with a reset deep copy of the active subtree) **atomically**, and is
      granted to the right roles.
- [ ] `frontend/lib/database.types.ts` regenerated from the live schema (raw `supabase gen
      types` output, not hand-edited) and the new columns/RPC are present.
- [ ] `npm run check` is green on the regenerated types.
- [ ] **This spec's Phase 0 status line is updated to ✅ DONE** with the migration filename.

### Recurrence engine (pure, unit-tested)
- [ ] `nextOccurrence` is correct for every frequency and interval, with explicit tests for:
      multi-day weekly roll-over; monthly day-of-month **clamping** (Jan 31 → Feb 28/29);
      monthly **positional** including `last` and the **skip** when a 5th weekday is absent;
      yearly **Feb 29 → Feb 28**; and interval > 1 for each frequency.
- [ ] End conditions tested: `never` (always advances); `on_date` (stops when next > until,
      boundary-inclusive); `after N` (the Nth occurrence is the last, no successor).
- [ ] No date drifts across a DST boundary; date parsing reuses the `lib/date-utils`
      local-midnight convention.
- [ ] `summarizeRule`, `presetForRule`, and `ruleFromPreset` round-trip every preset and a
      representative set of custom rules.

### Completion / spawn behavior
- [ ] Completing a recurring top-level task marks it (and its subtree) `completed` **and**
      creates a new active task with the next due date, same `recurrence_series_id`, and
      `occurrence_index + 1`; the new task carries a reset (active) copy of the subtree.
- [ ] When the rule's end condition is reached, completing the last occurrence creates **no**
      new task (plain completion).
- [ ] A non-recurring task completes exactly as it does today (no regression).
- [ ] The completed occurrence appears in the Completed view; the active list shows the new
      occurrence — optimistically and after reconcile, with rollback on API failure.

### Persistence & API
- [ ] `recurrence` round-trips through `POST /api/items` and `PATCH /api/items/[id]`; an
      invalid rule is rejected by the Zod schema (covered by route tests).
- [ ] Sending `{ recurrence: null }` clears the rule; clearing `due_date` clears `recurrence`.

### UI
- [ ] The Repeat control appears in the meta panel for top-level `task` rows only (hidden on
      subtasks and non-task items).
- [ ] The preset menu matches screenshot 1's options and check-marks the active preset.
- [ ] The Custom editor matches screenshot 2 (Frequency, `Every N`, day-of-week) and extends
      to Monthly/Yearly variants and the End Repeat control.
- [ ] Selecting a repeat with no due date sets the anchor (default today) before saving.
- [ ] A recurring task shows a repeat chip on its row; covered by a Storybook snapshot.
- [ ] Keyboard-operable and `prefers-reduced-motion`-respecting; visible focus on toggles.

### Demonstration
- [ ] A demo doc at `docs/demos/ALF-45-recurring-tasks/` shows: setting a custom weekly
      rule, completing the task, and the next occurrence appearing — plus the recurrence
      engine's test run. Linked as a live blob URL in the PR description (the `showboat`
      skill).

---

## Out of scope / open questions

- **Editing scope ("this vs. this-and-future").** Apple lets you edit/delete just one
  occurrence or the whole series. This spec edits the rule on the live occurrence only;
  full per-occurrence vs. series editing is **deferred**. (`recurrence_series_id` is added
  now so it's a non-migration follow-up.)
- **Hourly time-of-day.** Hourly (and any sub-day cadence) needs a *time* anchor, but the
  current due-date editor (`task-meta-panel`, `<input type="date">`) is **date-only** and
  `lib/date-utils` treats due dates as calendar dates. **Open question for the implementer:**
  either (a) add a time component to the due-date editor when the frequency is Hourly, or
  (b) defer Hourly to a follow-up and ship the daily-and-coarser presets first. Recommend
  (b) unless the time-picker work is cheap, to keep this ticket scoped.
- **Subtask copy semantics.** The spawned occurrence deep-copies the task's *active* subtree
  reset to active. If the reviewer prefers spawning the parent task alone (no subtasks), flag
  it — it's a localized change to `complete_and_spawn`.
- **Skipped/snoozed occurrences, natural-language entry, and notifications/reminders** are
  not part of this ticket.

---

## Implementation phases

- **Phase 0 — Schema & types (supervised).** Migration + RPC + type regen (above). Gated and
  marked done in this spec before the rest merges.
- **Phase 1 — Recurrence engine.** `frontend/lib/recurrence/` (pure TS) with the exhaustive
  Jest suite. Independent of Phase 0; can be built in parallel.
- **Phase 2 — API + store.** Zod schema, recurrence-aware complete route, `api-client` and
  `tasks-store` reconcile of the spawned occurrence (route + store tests). Depends on 0 + 1.
- **Phase 3 — UI.** Repeat control, preset menu, custom editor, row chip (RTL + Storybook).
  Depends on 2. Then the demo doc.
```
