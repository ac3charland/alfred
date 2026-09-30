import type * as React from 'react';

import { checkboxIncompleteClass, checkboxSizeClass } from '@/components/tasks/task-row.styles';
import { cn } from '@/lib/utils';

/**
 * The chrome the Reader overview's two checklists share — the wiki picks (Novel ideas, Evidence)
 * and Further reading — so a tick box, a heading row and a selection bar read as one family and a
 * change to any of them lands in both. Kept out of the components so neither file grows a second
 * copy of a class string, and so the wiki picks' committed Storybook baselines stay pinned to the
 * one definition they always had.
 *
 * The one key rule that belongs to the tick-row pattern rather than to a row's contents lives
 * here too: {@link ignoreEnter}.
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
/** One row: the tick slot beside the row's own `text-sm` text. */
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

/**
 * The tick box inside a row: the Inbox's select-mode box, filled teal once ticked, dimmed while a
 * send holds the row.
 */
export function tickBoxClass(isTicked: boolean, busy: boolean): string {
  return cn(
    checkboxSizeClass,
    'mt-0.5 flex shrink-0 items-center justify-center rounded border',
    isTicked ? 'border-accent-teal bg-accent-teal' : checkboxIncompleteClass,
    busy && 'opacity-50',
  );
}

/**
 * The ARIA checkbox pattern toggles on Space only. A `<button>` also clicks on Enter, so the
 * keydown's default is stopped there — Enter on a tick row does nothing.
 */
export function ignoreEnter(event: React.KeyboardEvent<HTMLButtonElement>) {
  if (event.key === 'Enter') event.preventDefault();
}

/**
 * The plain bulleted list every overview section falls back to when it is not a checklist — the
 * wiki's Novel ideas and Evidence without a token, Further reading without Instapaper.
 */
export const plainBulletListClass = 'mt-1 list-disc space-y-1 pl-5 text-sm text-foreground';
