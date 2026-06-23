import { cn } from '@/lib/utils';

/**
 * Visual styling for the task row, extracted so its many state-conditional cosmetic classes
 * (drop-target, completing, edit-mode) are locked by a unit test without having to reproduce
 * each live drag/edit/complete state in jsdom. The row's *behaviour* is covered by
 * task-row.test; this is its chrome. Classes already asserted there (e.g. the complete-state
 * `bg-accent-teal`, the chevron `rotate-90`, the `invisible` toggle) stay inline in the row.
 */

/** Outer wrapper: the completion-collapse grid-rows transition. */
export const collapseClass =
  'grid transition-[grid-template-rows] duration-300 ease-out delay-200 motion-reduce:transition-none';

/** Main row layout + colour transition. */
export const rowBaseClass = cn(
  'flex items-start gap-2 rounded-sm py-2 pr-2',
  'transition-colors duration-100 motion-reduce:transition-none',
);
/** Valid drop-target highlight (teal wash + ring). */
export const rowDropTargetClass = 'bg-accent-teal/15 ring-1 ring-accent-teal/50';
/** Default hover wash when the row is not a drop target. */
export const rowHoverClass = 'hover:bg-secondary/30';

/** Expand/collapse chevron button — keeps it from shrinking in the row flex. */
export const chevronButtonClass = 'shrink-0';
/** Chevron icon rotation transition. */
export const chevronIconClass = 'transition-transform duration-150 motion-reduce:transition-none';

/** The "+" shown in place of the checkbox while a task is dropped onto this row. */
export const dropPlusClass =
  'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-accent-teal bg-accent-teal text-background';

/** Completion checkbox sizing + the incomplete (un-checked) border/hover treatment. */
export const checkboxSizeClass = 'h-4 w-4';
export const checkboxIncompleteClass =
  'border-border hover:border-accent-teal transition-colors duration-100 motion-reduce:transition-none';

/** Inline title-edit input + its confirm checkbox. */
export const titleInputClass = 'flex-1 min-w-0 py-0.5';
export const confirmTitleClass = 'h-5 w-5 border-accent-teal bg-accent-teal';

/** The title text: wraps (break-words for unbroken strings), fades to low-contrast as the row completes. */
export const titleTextClass =
  'text-sm break-words transition-colors duration-300 delay-200 motion-reduce:transition-none';
