---
branch: claude/dismiss-subtask-entry-click-0mpez0
---

# Click outside dismisses the add-subtask entry

*2026-09-10T21:53:22.858Z*

ALF-127: clicking anywhere outside the inline "Add subtask" entry dismisses it and discards whatever was typed — the same as pressing Escape (ALF-66). Investigation found this already works: CaptureBox's compact form dismisses as soon as it loses focus (see the ALF-128 comment in task-row.tsx), and a real browser blurs a focused input on any outside press by default. This demo pins that behaviour with regression coverage (unit + e2e) rather than changing code.

Before: the "Plan the trip" row's Add-subtask field is open with unsaved text ("Half-typed subtask").

![](subtask-dismiss-click-outside-image-1.png)

After: a single click on the unrelated "Buy groceries" row closes the field and discards the unsaved text — no subtask is created.

![](subtask-dismiss-click-outside-image-2.png)

Regression coverage: frontend/components/tasks/task-row.test.tsx ("TaskRow — dismissing the add-subtask entry on an outside click (ALF-127)") pins the outside-dismiss, the discard-unsaved-text, and the stays-open-inside-it cases at the unit level; frontend/e2e/subtask-dismiss-click-outside.spec.ts reproduces the same journey shown above against a real browser, since jsdom can't replicate default focus-loss on a plain outside click.
