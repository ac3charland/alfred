---
branch: fix/date-independent-detail-panel-snapshot
---

# TaskDetailPanel due-date snapshot no longer depends on the run date

*2026-08-09T01:44:25.804Z*

The Tasks/TaskDetailPanel > TaskFields story hardcoded due_date: '2026-08-07'. frontend/lib/date-utils.ts's formatDueDate() renders a relative label ("Today" / "Tomorrow" / "Yesterday") whenever the due date is within a day of the render-time clock, and falls back to the absolute "Mon D" label otherwise. So the committed baseline (captured showing "Aug 7") mismatches on any day the real clock lands within +/-1 day of Aug 7 — a date-dependent (calendar-flaky) visual snapshot, not a code bug.

Reproducing the bug: reverting the fixture to the original 2026-08-07 and re-running the Storybook image-snapshot suite fails against the committed baseline (the diff below was captured on the day this fix was written, where the real clock landed one day after the fixture — so the chip rendered "Yesterday" instead of "Aug 7").

![](date-independent-detail-panel-snapshot-image-1.png)

The fix (this PR) replaces the fixture's due_date with a far-future literal, 2099-08-07 — matching the existing convention already used throughout frontend/components/tasks/task-row.stories.tsx (todayISODate() for a story that intentionally shows "Today", permanently-past/future 2020-.../2099-... literals everywhere else). The rendered month/day label is identical ("Aug 7"); only the year moves far enough away that diffDays between it and any realistic "now" is never +/-1 or 0, so the absolute-label branch is the only one that can ever fire.

Proof the render no longer depends on the clock: the same TaskFields story, screenshotted through a Playwright context whose global Date is faked to three different simulated "todays" — one day before the old fixture date, one day after it, and six years in the future. All three renders are byte-for-byte identical (same file size), and each shows the same "Aug 7" chip:

Simulated now: 2026-08-06 (one day before the old fixture date — would have rendered "Tomorrow" pre-fix):

![](date-independent-detail-panel-snapshot-image-2.png)

Simulated now: 2026-08-08 (one day after the old fixture date — would have rendered "Yesterday" pre-fix):

![](date-independent-detail-panel-snapshot-image-3.png)

Simulated now: 2032-01-15 (six years in the future — far past the old fixture's boundary window):

![](date-independent-detail-panel-snapshot-image-4.png)

The same latent bug existed in components/tasks/inbox-screen.stories.tsx's MidTriage story (also a visualTest-gated story, also hardcoding due_date: '2026-08-07' on its featured row) — fixed with the identical one-line change. Its snapshot happened not to be failing today only because the label swap is a small fraction of that story's much larger multi-row crop, under the gate's 1% pixel threshold; it was exactly as calendar-flaky, just not caught yet.

After the fix, npm run test:storybook -w frontend passes clean (41/41 suites, 188/188 tests, 122/122 snapshots), and the only regenerated baseline is tasks-taskdetailpanel--task-fields.png (MidTriage's baseline did not need updating — its pixels were already within threshold either way).
