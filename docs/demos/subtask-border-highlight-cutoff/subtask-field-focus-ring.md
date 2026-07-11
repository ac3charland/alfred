---
branch: claude/subtask-border-highlight-cutoff-r2xwp0
---

# Subtask field focus ring is no longer clipped on the left (ALF-112)

*2026-07-11T19:25:48.294Z*

The inline "Add subtask…" field draws a teal `focus-visible` ring that reaches ~3px past its border box (`ring-2` + `ring-offset-1`). The field lives inside `AnimatedHeightReveal`, whose height animation needs an `overflow-hidden` clip. The reveal's inner layer only had `py-1` — vertical room for the ring but no horizontal room — so where the `flex-1` field sits flush against the clip's left edge, the ring's left ~3px got shaved off.

**Before** — the focus ring is cut flat against the left edge (no rounded corner, the left segment is clipped away):

![Subtask field with its focus ring clipped flat on the left](subtask-field-focus-ring-image-1.png)

**After** — `px-1` (4px) on the reveal's inner layer clears the 3px ring, so the full rounded ring shows on every side, left included:

![Subtask field with the full rounded focus ring on all sides](subtask-field-focus-ring-image-2.png)

The fix lives in a named style constant so it's locked by the styles test (`addSubtaskRevealClass = 'px-1 py-1'` in `task-row.styles.ts`), asserted in `task-row.styles.test.ts`.
