import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { type TaskPriority, priorityOption } from '@/lib/priority';
import { cn } from '@/lib/utils';

export interface PriorityChipProperties extends Omit<
  React.HTMLAttributes<HTMLElement>,
  'children'
> {
  /** The level to render — `high` / `medium` / `low` (an unprioritised row renders no chip). */
  priority: TaskPriority;
  /**
   * Render the icon alone, no text label — the compact form used on a task row where space is
   * tight (ALF-67). The accessible name still carries the level (`Priority: High`) via the
   * `aria-label`, so the chip stays legible to assistive tech. The detail view uses the labelled
   * form. Defaults to false (icon + label).
   */
  symbolOnly?: boolean;
}

/**
 * The priority pill on a task row: a level-mapped lucide icon + label, rendered as a {@link Badge}.
 * Pass `symbolOnly` for the compact icon-only form used on the row (the label still rides the
 * `aria-label`). Mirrors `RecurrenceChip` / `DueDateChip`: it owns only the priority domain
 * mapping (icon, label, badge variant, default aria-label) and leans on the single-source
 * {@link priorityOption}; the pill geometry lives in `Badge`.
 */
export function PriorityChip({
  priority,
  symbolOnly = false,
  className,
  'aria-label': ariaLabel,
  ...properties
}: PriorityChipProperties) {
  // Backstop: the lookup can miss if a row reaches here without a known level — e.g. a
  // `task_items` row whose `priority` column the read layer dropped arrives as `undefined`.
  // Render nothing rather than destructuring the absent option (which white-screens the page).
  // The render gates (isPriorityLevel) already keep a missing level from getting this far.
  const option = priorityOption(priority);
  if (option === undefined) return null;
  const { label, icon: Icon, badgeVariant } = option;
  return (
    <Badge
      asButton
      variant={badgeVariant}
      interactive
      className={cn('inline-flex items-center gap-1 font-medium hover:opacity-80', className)}
      aria-label={ariaLabel ?? `Priority: ${label}`}
      {...properties}
    >
      <Icon
        size={10}
        strokeWidth={2.5}
        // In symbol-only mode (the compact row glyph) the icon grows to 16px on mobile so the
        // pill stands the same height as the neighbouring due-date chip; md+ keeps today's 10px.
        className={cn('shrink-0', symbolOnly && 'h-4 w-4 md:h-2.5 md:w-2.5')}
      />
      {!symbolOnly && label}
    </Badge>
  );
}
