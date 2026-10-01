import { checkboxIncompleteClass, checkboxSizeClass } from '@/components/tasks/task-row.styles';
import { cn } from '@/lib/utils';

/**
 * The chrome the Reader's two overview checklists share — Novel ideas + Evidence (`WikiPicks`)
 * and Further reading — so a tick, a row and a selection bar look and size the same in both.
 */

/**
 * The heading row, only while the section's controls render: 32px, the Select all button's
 * height, so the heading doesn't jump when the button swaps for "All sent".
 */
export const headingRowClass =
  'flex min-h-8 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-sm ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-background';
export const listClass = 'mt-1 flex flex-col gap-0.5';
/** One item's row: the tick slot beside the item's own `text-sm` text. */
export const rowClass = 'flex items-start gap-2.5 rounded-md px-1.5 py-1 text-sm text-foreground';
/**
 * The Button atom's centred, single-line chrome reset into a full-width, wrapping row — the whole
 * row is the hit target, so it works on a phone. A disabled row keeps its text at full strength;
 * only its tick box dims, the atoms' 50%.
 */
export const tickRowClass = cn(
  rowClass,
  'h-auto w-full justify-start whitespace-normal text-left font-normal',
  'disabled:opacity-100',
);
export const tickSlotClass = cn(
  checkboxSizeClass,
  'mt-0.5 flex shrink-0 items-center justify-center',
);
export const statusClass = 'inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground';
export const barClass = cn(
  'mt-2 flex flex-wrap items-center gap-2 border-t border-border/60 px-1.5 pt-1.5',
);
/**
 * The counter's and Clear's spacing, even about the send button: with the bar's `gap-2`, the
 * counter's `mr-2` and Clear's own `px-2` (narrowing the sm size's `px-3`) put each 16px from the
 * button. Clear's padding would otherwise add to the gap on its side only.
 */
export const counterClass = 'mr-2 text-sm font-semibold text-accent-teal';
export const clearClass = 'px-2';

/** An unsent item's tick box: teal and filled once ticked, dimmed while a send holds it. */
export function tickBoxClass(ticked: boolean, busy: boolean): string {
  return cn(
    checkboxSizeClass,
    'mt-0.5 flex shrink-0 items-center justify-center rounded border',
    ticked ? 'border-accent-teal bg-accent-teal' : checkboxIncompleteClass,
    busy && 'opacity-50',
  );
}
