import type { CellStatus } from '@/lib/habits';

/**
 * The history grid's "lit filament" finish, kept out of the components so the class strings
 * are unit-testable and every cell state is declared in one place.
 *
 * Cells are dim tinted plates with a 1px accent rim; the CONNECTOR carries the light. That
 * puts the emphasis on the unbroken run rather than on individual days — and it means the hue
 * is doing less work than a solid fill would, so every state also carries a SHAPE cue (see
 * {@link CELL_SHAPE}) and stays distinguishable with no colour at all.
 */

/** Cell geometry — the square and the gap the connectors bridge, shared by grid and cell. */
export const CELL_SIZE_PX = 26;
export const CELL_GAP_PX = 6;

/** The plate: fill + rim per state. */
export const CELL_PLATE: Record<CellStatus, string> = {
  met: 'bg-accent-green/20 ring-1 ring-inset ring-accent-green/75',
  partial: 'bg-accent-amber/20 ring-1 ring-inset ring-accent-amber/75',
  missed: 'bg-accent-red/20 ring-1 ring-inset ring-accent-red/75',
  // Excused by hand: neither an outcome colour nor blank-unknown, so a neutral plate with a rim.
  skipped: 'bg-habit-unknown ring-1 ring-inset ring-border',
  // No row at all: the same neutral plate, deliberately WITHOUT a rim so it reads as emptier.
  unknown: 'bg-habit-unknown',
  // Before the habit started, off its weekday set, or still ahead.
  not_applicable: 'border border-dashed border-border',
};

/**
 * The non-colour cue layered over the plate, so met / partial / missed / skipped / unknown stay
 * apart in greyscale: a uniform face, a lighter diagonal half, an inner ring, a centred dash,
 * and nothing at all.
 */
export const CELL_SHAPE: Record<CellStatus, string> = {
  met: '',
  partial: 'bg-[linear-gradient(135deg,transparent_50%,rgba(255,255,255,0.22)_50%)]',
  missed: 'ring-1 ring-inset ring-accent-red/50 m-[5px] rounded-[2px]',
  skipped: '',
  unknown: '',
  not_applicable: '',
};

/** Today's marker: the teal ring the epic reserves for "you are here". */
export const CELL_TODAY = 'ring-2 ring-accent-teal ring-offset-0';

/** The connector's two tones — lit for an earned continuation, inert grey for a forgiven one. */
export const LINK_TONE = {
  streak: 'bg-accent-green shadow-[0_0_10px_2px_rgba(52,211,153,0.5)]',
  bridge: 'bg-habit-bridge',
} as const;
