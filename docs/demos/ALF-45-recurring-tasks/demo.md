---
branch: claude/sharp-noether-no5w8q
---

# Recurring tasks (ALF-45)

*2026-06-24T02:58:53.230Z*

ALF-45 makes tasks repeat, replicating the Apple Reminders recurrence UX. A task carries an optional structured recurrence rule (a JSONB column); completing a recurring top-level task marks it (and its subtree) completed AND spawns the next occurrence with the next due date. All the date math lives in a pure, framework-free engine in `frontend/lib/recurrence/` so the edge cases are exhaustively covered.

## The engine, demonstrated

The next-occurrence math is the heart of the ticket. This runnable script (`engine-demo.ts`, beside this doc) calls the real engine — `nextOccurrence`, `summarizeRule`, `ruleFromPreset` — and prints its output. It's bundled with esbuild (which resolves the `@/` alias from the frontend tsconfig) and run with node, so the captured output below is the engine's own, covering: the Weekly-on-Monday preset spawning the next Monday; a multi-day biweekly hopping within the week then jumping the interval; monthly day-of-month clamping (Jan 31 → Feb 28); monthly positional (last Friday); yearly Feb 29 → Feb 28; and an `after N` series returning null once it ends.

```bash
node_modules/.bin/esbuild docs/demos/ALF-45-recurring-tasks/engine-demo.ts --bundle --platform=node --tsconfig=frontend/tsconfig.json 2>/dev/null | node
```

```output
Weekly on Monday
  summary:  Weekly on Mon
  from 2026-06-01 (#1) → next: 2026-06-08

Every 2 weeks on Mon, Wed (Mon → Wed)
  summary:  Every 2 weeks on Mon, Wed
  from 2026-06-01 (#1) → next: 2026-06-03

Every 2 weeks on Mon, Wed (Wed → +2wk Mon)
  summary:  Every 2 weeks on Mon, Wed
  from 2026-06-03 (#2) → next: 2026-06-15

Monthly on the 31st (clamps to Feb 28)
  summary:  Monthly
  from 2026-01-31 (#1) → next: 2026-02-28

Monthly on the last Friday
  summary:  Monthly on the last Fri
  from 2026-06-26 (#1) → next: 2026-07-31

Yearly on Feb 29 (clamps to Feb 28)
  summary:  Yearly
  from 2028-02-29 (#1) → next: 2029-02-28

Daily, ends after 2 (from #1)
  summary:  Daily for 2 times
  from 2026-06-01 (#1) → next: 2026-06-02

Daily, ends after 2 (from #2 — no successor)
  summary:  Daily for 2 times
  from 2026-06-02 (#2) → next: null
```

## Completion spawns the next occurrence

When a recurring top-level task is completed, the API route loads its rule, computes the next due date with this same engine, and (when the series hasn't ended) calls the `complete_and_spawn` RPC: in one transaction it cascade-completes the subtree and inserts a fresh **active** occurrence with the next due date, the same `recurrence_series_id`, `occurrence_index + 1`, and a reset deep copy of the active subtree. The completed task stays as history (Completed view); the new occurrence appears in the active list. The optimistic store predicts the spawned row with the same engine and reconciles it with the server's authoritative row (rolling back on failure). When the end condition is reached, completing the last occurrence spawns nothing.

## The UI: row chip, preset menu, custom editor

A recurring task shows a repeat chip on its row (alongside the due-date chip) so recurrence is visible without expanding. In the task's meta panel, a **Repeat** control (top-level tasks only) shows the current rule's summary, opens a preset dropdown (Daily / Weekdays / Weekends / Weekly / Biweekly / Monthly / Every 3 Months / Every 6 Months / Yearly) with a checkmark on the active preset, and a **Custom…** entry that opens the full editor (Frequency, Every-N, the S M T W T F S day row, Monthly day-of-month vs positional, Yearly, and End Repeat). Hourly is implemented in the engine but deferred from the UI — a sub-day cadence needs a time-of-day anchor the date-only due-date editor doesn't yet have.

Below is the row chip, captured from its `Atoms/RecurrenceChip` Storybook story (the *WeeklyMultiDay* image snapshot — "Every 2 weeks on Mon, Wed"):

![](demo-image-1.png)

## Closeout

The engine behavior above is reproducible here with no credentials. Driving the full click-path in the live app (open a task → pick Custom Weekly → check the box → watch the next occurrence slot into the active list) additionally needs a running app + Supabase, which a CI/web sandbox lacks, so it stays a local/high-touch step; the deterministic engine output and the row-chip snapshot stand in for it here. The schema migration + `complete_and_spawn` RPC + type regen were landed in the supervised Phase 0 (migration `0006_recurring_tasks.sql`).
