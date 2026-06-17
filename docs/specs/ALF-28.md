# ALF-28 — Add badges to folders in tasks for items due today/past due

## Context / problem

The sidebar folder list (`frontend/components/tasks/folder-nav.tsx`) renders one
link per folder, but a folder link gives no signal about what's waiting inside.
To know a folder holds tasks that need attention today, the user has to open the
folder and scan its rows. Due-dates already drive per-row styling — a task row's
due chip turns amber once it's overdue (`task-row.tsx:569`, via
`isDueDateOverdue` in `lib/date-utils.ts`) — but nothing rolls that
attention-signal **up** to the folder level.

We want each folder in the sidebar to surface, at a glance, **how many of its
tasks are due today or earlier** (today + past-due, combined), so the user can
triage from the nav without opening every folder.

### Confirmed scope (with the reporter)

- **Placement:** the **sidebar folder list** only — each folder link in
  `FolderNav`. Not the folder-view header.
- **One combined badge** per folder (not separate past-due / due-today badges).
- **What it counts:** the number of **active (incomplete) task items** in that
  folder whose `due_date` is **today or earlier** (local time). Completed tasks
  are excluded. Subtasks count too (they share their folder bucket).
- The badge shows the **count** (a number), not just a dot.

## Grounding: how the data is already available

- `useTasks()` (`frontend/lib/stores/tasks-store.tsx`) exposes the full, flat
  `Item[]` store on the client — global across the `(tasks)` group and already
  seeded in the layout. `FolderNav` is a client component (`'use client'`), so it
  can read `useTasks()` directly, exactly as `CompletedCount`
  (`components/tasks/completed-count.tsx`) and `TaskList` do.
- Each `Item` has `folder_id`, `due_date` (`string | null`), `status`
  (`'active' | 'completed'`), and `item_type`. The DB constraint
  `items_task_only_fields` guarantees only `item_type = 'task'` rows can carry a
  non-null `due_date`, so **filtering on `due_date != null` already restricts to
  tasks** — no separate `item_type` check is required (an explicit
  `item_type === 'task'` guard may still be added for clarity/defence).
- Subtasks share their ancestor's `folder_id` (the store cascades `folder_id` on
  `moveTask`/`reparentTask`, see `tasks-store.tsx`), so counting the **flat**
  item list by `folder_id` naturally includes nested subtasks without walking the
  tree.
- `lib/date-utils.ts` already has `isDueDateOverdue(iso)` — true when the date is
  **strictly before** today (today is **not** overdue). The badge needs
  "**today or earlier**", which is a slightly wider predicate, so a new helper is
  warranted (see below).

## Proposed change

### 1. Date helper: "due today or earlier"

Add a pure predicate to `frontend/lib/date-utils.ts`, alongside
`isDueDateOverdue`, reusing the existing `parseDueDate` internal:

```ts
/**
 * Returns true when the ISO due-date string represents today (local) or any
 * earlier date. Unlike isDueDateOverdue, today itself counts.
 */
export function isDueTodayOrOverdue(iso: string): boolean {
  // startOfToday = local midnight today; a due date of "today" parses to exactly
  // this, so `<=` includes today and every earlier day, excludes the future.
  return parseDueDate(iso) <= new Date(new Date().toDateString());
}
```

Keep `isDueDateOverdue` as-is — it is still used by the per-row due chip and means
something different (strictly-before-today). The two coexist.

### 2. Per-folder count selector

Compute, for the folder list, the number of active tasks due-today-or-earlier in
each folder. Derive it from the shared store so it updates optimistically with
every capture, completion, due-date edit, and drag-to-folder.

Preferred shape: a small selector hook in `tasks-store.tsx`, e.g.
`useDueCountsByFolder(): Record<string, number>`, that memoizes over `useTasks()`
and returns a map keyed by `folder_id`. A folder counts an item when **all** hold:

- `item.folder_id === folderId` (so inbox items, `folder_id === null`, never
  count toward any folder),
- `item.status === 'active'` (completed excluded),
- `item.due_date != null` **and** `isDueTodayOrOverdue(item.due_date)`.

Returning a map (vs. a per-folder hook) lets `FolderNav` look up each folder's
count in its existing `folders.map(...)` without N hook calls. Co-locating it
with the store keeps the filter logic next to `useScopedTasks` and unit-testable
in isolation. (An equivalent inline `useMemo` in `FolderNav` is acceptable if it
stays as cheap and is still covered by tests.)

### 3. Render the badge in `FolderNav`

In `frontend/components/tasks/folder-nav.tsx`, inside the folder link
(`ViewLink`, around `task-row.tsx`'s sibling at `folder-nav.tsx:204–215`), render
a count badge **when the folder's count is > 0**; render nothing when it's 0 (no
empty/"0" chip — folders with nothing due stay clean, matching how `TypeBadge`
and the row count chips hide at zero).

- Place the badge at the **trailing edge** of the link, after the
  `<span className="truncate">{folder.name}</span>`, so a long folder name
  truncates before the badge rather than pushing it off. The badge must be
  `shrink-0`.
- **Styling** mirrors the existing chip vocabulary and the row's overdue
  treatment (amber = "needs attention today"): a small rounded-full chip using
  the `accent-amber` tokens, e.g.
  `shrink-0 rounded-full border border-accent-amber/50 px-2 py-0.5 text-xs font-medium text-accent-amber`
  (same geometry as the due chip at `task-row.tsx:568`). Keep it readable against
  both the active and inactive `navLinkClass` backgrounds.
- **Accessibility:** give the badge an `aria-label` that names what it means, not
  just the bare number — e.g. `aria-label={`${count} due today or overdue`}` —
  so the link's accessible context isn't just "Work 3".
- Consider extracting the chip into a tiny presentational component (e.g.
  `components/tasks/due-count-badge.tsx`) so it can have its own Storybook story
  and snapshot, paralleling `TypeBadge`. Optional, but it keeps `FolderNav` lean.

No schema change, no API change, no new fetch — this is a pure client-side
derivation over data already in the store, plus one date helper and one badge.

## Acceptance criteria

- [ ] Each folder link in the sidebar shows a badge with the **count of active
      task items in that folder whose `due_date` is today or earlier** (today +
      past-due, combined into one number).
- [ ] A folder with **no** such items shows **no badge** (not a "0" chip).
- [ ] **Completed** tasks never contribute to the count, even if their due date
      is today or past.
- [ ] Tasks **due in the future** (after today) never contribute to the count.
- [ ] A task due **exactly today** **is** counted (boundary: today is included).
- [ ] **Subtasks** in the folder count toward their folder's badge (the flat
      `folder_id` match includes nested items).
- [ ] Inbox items (`folder_id === null`) never contribute to any folder's badge.
- [ ] The badge updates **optimistically** as the store changes — adding a due
      task to a folder, completing one, clearing/changing a due date, or dragging
      a task into/out of a folder updates the affected folder counts without a
      hard refresh.
- [ ] The badge has an accessible label describing its meaning (e.g.
      "N due today or overdue"), not just the number.
- [ ] Long folder names still truncate; the badge is never clipped or pushed
      off-row (badge is `shrink-0`, name truncates first).
- [ ] Tests express the new behavior (Red/Green TDD; failing first):
  - [ ] `lib/date-utils.test.ts`: `isDueTodayOrOverdue` returns true for a past
        date and for today, false for tomorrow/future (cover the today boundary).
  - [ ] Store/selector unit test (`lib/stores/tasks-store.test.tsx`): the
        per-folder due-count selector buckets by `folder_id`, includes
        today-or-earlier active tasks (and nested subtasks), and excludes
        completed, future-due, due-date-less, and inbox items.
  - [ ] `components/tasks/folder-nav.test.tsx`: seed the providers with items so a
        folder renders its badge with the right number; a folder with nothing due
        renders no badge; the badge exposes its `aria-label`.
  - [ ] A Storybook story + committed image-snapshot for the badge (its own
        component story, or a `FolderNav` story) so the visual chip is under the
        snapshot gate — since the exact color/geometry isn't observable in jsdom.
- [ ] `npm run check` is green.
- [ ] A demo doc at `docs/demos/ALF-28.md` (showboat) reproduces a folder showing
      its due-today/past-due badge and the count changing as a task is completed
      or its due date moved, with a screenshot of the sidebar.

## Out of scope / open questions

- **Separate past-due vs. due-today badges / colors.** Deliberately one combined
  badge per this ticket's confirmed scope. Splitting overdue (red/destructive)
  from due-today (amber) into two chips is a possible follow-up, not done here.
- **Folder-view header badge.** The same count could also be shown on the open
  folder's header (`folder-view.tsx`); out of scope — sidebar only for now.
- **Completed view / inbox badges.** No badge on the Completed link or any
  inbox affordance; this ticket is about folder links only.
- **Date helper consolidation.** `isDueDateOverdue` and the new
  `isDueTodayOrOverdue` intentionally coexist (they mean different things);
  merging or parameterizing them is not pursued here.
- **Server-side counts / pagination.** Counts are derived client-side from the
  already-loaded store ("fetch-all then filter" per the data-flow convention); no
  new endpoint or aggregate query is introduced.
