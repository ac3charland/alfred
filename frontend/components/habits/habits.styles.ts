import type { CellStatus } from '@/lib/habits';

/**
 * The history grid's "lit filament" finish, kept out of the components so the class strings
 * are unit-testable and every cell state is declared in one place.
 *
 * Cells are dim tinted plates with a 1px accent rim; the CONNECTOR carries the light. That
 * puts the emphasis on the unbroken run rather than on individual days.
 *
 * The plate is the WHOLE of a cell's treatment — nothing is drawn on its face. Each outcome has
 * its own hue and its own legend swatch, so a mark layered on top only adds something to decode
 * for a distinction the colour has already made. The single exception lives in the cell itself:
 * `skipped` and `unknown` share one neutral plate, so that pair — and only that pair — is told
 * apart by a rim and a centred dash.
 */

/** Cell geometry — the square and the gap the connectors bridge, shared by grid and cell. */
export const CELL_SIZE_PX = 26;
export const CELL_GAP_PX = 6;

/**
 * Touch geometry: a 38px square on a 44px pitch, the thumb target Apple's guidelines and WCAG
 * 2.5.5 name. Each button's hit area reaches half the gap past its square, so neighbouring
 * targets meet and a tap never lands in a dead gap.
 */
export const TOUCH_CELL_SIZE_PX = 38;
export const TOUCH_CELL_PITCH_PX = TOUCH_CELL_SIZE_PX + CELL_GAP_PX;
export const TOUCH_HIT_OUTSET_PX = CELL_GAP_PX / 2;

/*
 * The sizes live in CSS behind the `touch:` variant rather than in JS: the grid is
 * server-rendered and a media-query hook answers false until hydration, so a JS switch would
 * paint 26px squares and then jump. Each string carries both sizes, the desktop one first.
 */

/** A cell's square. */
export const CELL_BOX = 'h-[26px] w-[26px] touch:h-[38px] touch:w-[38px]';
/** The grid's (and the weekday labels') seven rows. */
export const GRID_ROWS = 'grid-rows-[repeat(7,26px)] touch:grid-rows-[repeat(7,38px)]';
/** A weekday label's line, centring it on its row. */
export const WEEKDAY_LINE = 'leading-[26px] touch:leading-[38px]';
/** The bar bridging two days. */
export const CONNECTOR_WIDTH = 'w-[10px] touch:w-[14px]';
/** The dash on an excused day's face. */
export const SKIP_DASH = 'text-[13px] touch:text-[16px]';
/** A cell button's touch hit area: a pseudo-element 3px past the square on every side. */
export const CELL_HIT_AREA =
  "relative touch:before:absolute touch:before:-inset-[3px] touch:before:content-['']";

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

/** Today's marker: the teal ring the epic reserves for "you are here". */
export const CELL_TODAY = 'ring-2 ring-accent-teal ring-offset-0';

/** The connector's two tones — lit for an earned continuation, inert grey for a forgiven one. */
export const LINK_TONE = {
  streak: 'bg-accent-green shadow-[0_0_10px_2px_rgba(52,211,153,0.5)]',
  bridge: 'bg-habit-bridge',
} as const;
