/**
 * The search result list's two densities, extracted so the touch sizing is locked by a unit test.
 *
 * `compact` is the desktop dropdown's dense row, sized for a mouse. `touch` is the mobile sheet's
 * row: `min-h-11` (44px) meets the app's mobile tap target, with a little more air between the
 * text and the kind badge.
 */
export type SearchResultsDensity = 'compact' | 'touch';

const OPTION_ROW_BASE = 'flex cursor-pointer items-center rounded-md px-2';

export const optionRowDensityClass: Record<SearchResultsDensity, string> = {
  compact: `${OPTION_ROW_BASE} gap-2 py-1.5`,
  touch: `${OPTION_ROW_BASE} min-h-11 gap-3 py-2`,
};

/**
 * The mobile sheet's status row — the result count on the left, "Show completed" on the right —
 * which on touch replaces the desktop dropdown's key-hint footer.
 */
export const touchStatusRowClass =
  'flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2 text-xs text-muted-foreground';

/**
 * The mobile sheet's scrolling results region. It fills whatever height the field and status row
 * leave, scrolls on its own (`overscroll-contain` keeps a fling from chaining to the page behind
 * the sheet), and pads its bottom by the home-indicator safe area so the last row clears it.
 */
export const touchResultsRegionClass =
  'min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))]';
