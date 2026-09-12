---
branch: claude/dismiss-subtask-entry-click-0mpez0
---

# Dismissing the add-subtask entry while unfocused

*2026-09-11T17:51:22.175Z*

ALF-127's actual bug: the add-subtask entry's only dismissal path was the field's own blur event. After a touch "Add" tap (ALF-98), the field deliberately stays open — ready for the next subtask — with focus landing nowhere, because that tap's blur is skipped on purpose so the submit isn't cut off. From that state no further blur can ever fire, so a later outside press had nothing left to dismiss. The fix adds a second, focus-independent dismiss: an outside pointer press now closes the entry via the same document-level listener the detail panel already uses (ALF-78's useDismiss), scoped to the row, regardless of what currently holds focus.

1. Start: the field is open and focused (the ring on the input) after typing — this ordinary case already dismissed correctly before this PR, via a plain blur.

![](subtask-dismiss-click-outside-image-1.png)

2. THE BUG'S PRECONDITION: reproducing the touch-tap sequence (pointerdown on Add, then a blur with the pressing-submit guard active) strands the field open with the focus ring gone — nothing inside it is focused, same as after a real mobile "Add" tap. Note the input no longer carries the teal ring.

![](subtask-dismiss-click-outside-image-2.png)

3. THE NET-NEW BEHAVIOR: from that exact stranded state, a single click on the unrelated "Buy groceries" row now closes the field. Before this fix, nothing could dismiss it from here — there was no focus left to blur, so an outside click did nothing and the field stayed stuck open indefinitely.

![](subtask-dismiss-click-outside-image-3.png)

Regression coverage: frontend/components/tasks/task-row.test.tsx ("TaskRow — dismissing the add-subtask entry on an outside click (ALF-127)") pins the general outside-dismiss and discard-unsaved-text cases, plus the specific defect this PR fixes — "closes on an outside press even after the field already lost focus without dismissing" — which reproduces the same touch-submit sequence shown above at the unit level and was confirmed to fail without the fix and pass with it.
