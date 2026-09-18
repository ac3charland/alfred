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

/**
 * The card itself. Selection (the overview open) takes the module's green border and a
 * secondary wash — `border-accent-green/60` is `MODULE_ACCENT.reader.border` with an opacity
 * modifier, spelled out here as a literal rather than built from the imported constant:
 * Tailwind's scanner needs the whole utility name in the source text, and appending `/60` to a
 * string read from a variable at runtime produces nothing in the compiled CSS (see the
 * `modules.ts` doc comment). A failed or refused row dims like the Comms shelf row: the post is
 * still here, just not what today's reading is about.
 */
export function rowShellClass(selected: boolean, dimmed: boolean): string {
  return cn(
    'w-full rounded-lg border px-3 py-2 text-left',
    'transition-colors duration-100 motion-reduce:transition-none',
    'focus-within:border-accent-green/60',
    selected
      ? 'border-accent-green/60 bg-secondary/40'
      : 'border-transparent hover:bg-secondary/25',
    dimmed && !selected && 'opacity-70 hover:opacity-100',
  );
}

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

/** The verb row beneath the card body. */
export const verbRowClass = 'mt-2 flex flex-wrap items-center gap-2';
