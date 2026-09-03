import { CalendarRange } from 'lucide-react';

import { Badge } from '@/components/atoms/badge';

/** The badge's own words, doubling as its accessible name — there is no other text to name it. */
const WEEK_PLAN_LABEL = 'Week plan item';

/**
 * The provenance chip on a row a weekly review planned: a muted pill reading **Week plan** behind
 * the {@link CalendarRange} glyph — the same icon the Week Plan nav item and view header use, so
 * the badge points at where the plan document itself lives.
 *
 * Muted rather than coloured on purpose. The row's five colours are already spoken for (blue =
 * due, amber = due today, red = overdue or high priority, teal = interactive, green =
 * dispatch-ready), and this is a label like the Type badge, not a verdict.
 *
 * It is **inert by construction**, a `<span>` in every mode, like {@link DispatchReadyMark}:
 * there is nothing to click — the badge states where the row came from — and select mode's row is
 * a single `<button>` that forbids a nested control. The row decides WHERE it shows (a planned
 * top-level item of any type); the badge only knows how to look.
 */
export function WeekPlanBadge() {
  return (
    <Badge
      variant="muted"
      className="inline-flex items-center gap-1 font-medium"
      aria-label={WEEK_PLAN_LABEL}
    >
      <CalendarRange size={11} strokeWidth={2} className="shrink-0" aria-hidden="true" />
      Week plan
    </Badge>
  );
}
