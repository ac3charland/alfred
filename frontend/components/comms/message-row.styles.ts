import { cn } from '@/lib/utils';

/**
 * The queue row's chrome, kept out of the row itself so its state-conditional classes (selected,
 * shelved, leaving) are locked by a unit test without staging each live interaction in jsdom.
 * The row's BEHAVIOUR is covered by `message-row.test`; this is what it looks like.
 */

/**
 * The exit collapse. A cleared row shrinks its own height and the rows below pull up — the same
 * grid-rows trick the task row uses, with no delay: nothing has to be read on the way out, so
 * the gap closes in step with the fade rather than behind it.
 */
export const rowCollapseClass =
  'grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none';

/** The exit fade, riding on top of the collapse. */
export const rowFadeClass =
  'transition-opacity duration-200 ease-out motion-reduce:transition-none';

/**
 * A grid item's automatic minimum size is `min-content`, so without `min-w-0` a long ask would
 * force the collapse track wider than the card and leave `truncate` nothing to clip.
 */
export const rowCollapseInnerClass = 'min-w-0';

/**
 * The card itself. Selection is a border and a wash rather than a ring, because the row expands
 * when selected and a ring around a growing box reads as a focus trap. The shelf variant is
 * dimmer throughout: it is an archive being spot-checked, not a list of obligations.
 */
export function rowShellClass(selected: boolean, shelved: boolean): string {
  return cn(
    'w-full rounded-lg border px-3 py-2 text-left',
    'transition-colors duration-100 motion-reduce:transition-none',
    'focus-within:border-accent-blue/60',
    selected ? 'border-accent-blue/60 bg-secondary/40' : 'border-transparent hover:bg-secondary/25',
    shelved && !selected && 'opacity-70 hover:opacity-100',
  );
}

/** Line one: who, through which account, when. The name carries the weight; the rest is context. */
export const rowSenderClass = 'font-medium text-foreground';

/** The muted middle of line one — the account label and the arrival time. */
export const rowMetaClass = 'text-xs text-muted-foreground';

/**
 * Line two: the ask. Clipped to one line, because the whole promise of the row is that it can
 * be read at a glance — a wrapping ask turns the queue back into a list of emails.
 */
export const rowAskClass = 'truncate text-[13px] leading-snug text-muted-foreground';

/** The ask on the selected row, which is expanded and no longer competing for vertical space. */
export const rowAskSelectedClass = 'text-[13px] leading-snug text-foreground';

/** The detail panel beneath an expanded row. */
export const detailClass = 'mt-3 flex flex-col gap-3 border-t border-border/60 pt-3';

/** The body excerpt: pre-wrapped and capped, so a long thread scrolls inside the row. */
export const detailBodyClass = cn(
  'max-h-56 overflow-y-auto whitespace-pre-wrap rounded-md bg-input/60 p-2',
  'text-[12.5px] leading-relaxed text-muted-foreground',
);

/** A tier section's eyebrow: the tier name and its count, sitting above the rows. */
export const sectionEyebrowClass =
  'text-xs font-semibold uppercase tracking-widest text-muted-foreground';

/**
 * ASAP wears the module's accent and a glow; the quieter tiers wear nothing. The whole claim
 * ASAP makes is "break focus for this", and a tier that looks like every other tier cannot
 * make it — which is also why only one tier is allowed to.
 */
export function sectionShellClass(loud: boolean): string {
  return cn(
    'flex flex-col gap-1 rounded-xl border p-3',
    loud ? 'border-accent-blue/40 bg-accent-blue/[0.04] glow-blue' : 'border-border/60',
  );
}
