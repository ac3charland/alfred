/**
 * Expands a control's touch target to ≥44px on mobile via an invisible overlay that doesn't
 * change layout (the drawn box stays its small visual size); removed at `md`+ where pointer
 * devices don't need it. A near-miss tap lands on the control instead of falling just outside it
 * — the difference between a button that reliably fires and one that feels broken on a phone.
 * Used by the task-row checkbox / expand chevron and the inline add-subtask "Add" button.
 */
export const mobileTapClass =
  "relative after:absolute after:-inset-3 after:content-[''] md:after:hidden";
