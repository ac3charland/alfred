import { MODULE_ACCENT } from '@/lib/modules';
import { cn } from '@/lib/utils';

/**
 * The row's chrome, kept out of the row itself so its state-conditional classes (selected,
 * dimmed, leaving) are locked by a unit test without staging each live interaction in jsdom —
 * mirrors `message-row.styles.ts`.
 */

/** The exit collapse the archive verb plays — the same grid-rows trick every row exit uses. */
export const rowCollapseClass =
  'grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none';

/** The exit fade, riding on top of the collapse. */
export const rowFadeClass =
  'transition-opacity duration-200 ease-out motion-reduce:transition-none';

/**
 * A grid item's automatic minimum size is `min-content`, so without `min-w-0` a long title or
 * gist would force the collapse track wider than the card.
 */
export const rowCollapseInnerClass = 'min-w-0';

/** The three things the card's chrome answers to, each independent of the other two. */
export interface RowShellState {
  /** The row the keyboard is pointing at. At most one row in a list holds it. */
  selected: boolean;
  /** The row's overview panel is open. A selected row may be either; so may an unselected one. */
  expanded: boolean;
  /** A failed or refused row — still here, just not what today's reading is about. */
  dimmed: boolean;
}

/**
 * The card itself. Two states that look alike but mean different things: EXPANDED (the overview
 * is open) takes the module's green border and a secondary wash, while SELECTED (the keyboard is
 * pointing here) adds a ring — so a selected collapsed row and a selected expanded row are both
 * legible, and neither implies the other. The ring rather than the border is what keeps them
 * apart at a glance; Comms can fold the two together because its row expands exactly when it is
 * selected, and this list's does not.
 *
 * `border-accent-green/60` is `MODULE_ACCENT.reader.border` with an opacity modifier, spelled out
 * as a literal rather than built from the imported constant: Tailwind's scanner needs the whole
 * utility name in the source text, and appending `/60` to a string read from a variable at
 * runtime produces nothing in the compiled CSS (see the `modules.ts` doc comment).
 */
export function rowShellClass({ selected, expanded, dimmed }: RowShellState): string {
  return cn(
    'w-full rounded-lg border px-3 py-2 text-left',
    'transition-colors duration-100 motion-reduce:transition-none',
    'focus-within:border-accent-green/60',
    expanded
      ? 'border-accent-green/60 bg-secondary/40'
      : 'border-transparent hover:bg-secondary/25',
    selected && 'ring-1 ring-accent-green/60',
    dimmed && !expanded && !selected && 'opacity-70 hover:opacity-100',
  );
}

/**
 * The key that runs a verb, shown beside its label on the selected row only — hints anywhere else
 * would point at keystrokes that cannot reach those verbs. Hidden below `md` rather than below
 * `sm`: a phone in landscape clears `sm` and still has no keyboard. Marked `aria-hidden` at the
 * call site, so the verb's accessible name stays the verb.
 */
export const hintClass =
  'hidden md:inline-flex rounded border border-border bg-background px-1 py-0.5 font-mono text-[10px] text-muted-foreground';

/**
 * The publication eyebrow — the module's own accent, so it always reads as Reader's, not a
 * link. Reads `MODULE_ACCENT.reader.text` directly (no opacity modifier to append), unlike the
 * selected border below, so a recolour of the module stays a one-line change in `modules.ts`.
 */
export const eyebrowClass = cn('text-xs font-semibold', MODULE_ACCENT.reader.text);

/** The meta line: arrival date and read time. */
export const metaClass = 'text-xs text-muted-foreground';

/** The title, in the display serif every row/card title in the app uses. */
export const titleClass = 'mt-1.5 font-serif text-lg leading-snug text-foreground';

/** The gist — the content, not a label, so it is never clipped. */
export const gistClass = 'mt-1 text-sm leading-relaxed text-foreground';

/** The floor states' placeholder line, in place of a gist that doesn't exist yet or ever will. */
export const placeholderGistClass = 'mt-1 text-sm italic leading-relaxed text-muted-foreground';

/**
 * A summary being replaced: the previous one, dimmed, under the pending marker. Blanking it
 * would show a judgment that has not happened yet, and the owner asked for a re-run, not for
 * their summary to be taken away while it runs.
 */
export const supersededGistClass = 'mt-1 text-sm leading-relaxed text-foreground opacity-60';

/**
 * The strip under a finished summary: where it came from on one side, the verb that replaces it
 * on the other. Inside the overview panel, because it is about the summary rather than about the
 * post, and a stamp on a collapsed row would be noise on every row of the list.
 */
export const overviewFooterClass =
  'mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3';

/** Which model wrote the summary, under which prompt, and when — the line a re-run visibly moves. */
export const summaryStampClass = 'text-xs text-muted-foreground';

/** The verb row beneath the card body. */
export const verbRowClass = 'mt-2 flex flex-wrap items-center gap-2';
