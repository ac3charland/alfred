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
}

/**
 * The priority pill on a task row: a level-mapped lucide icon + label, rendered as a clickable
 * {@link Badge} that opens the priority editor (the meta panel's `PrioritySelect`). Mirrors
 * `RecurrenceChip` / `DueDateChip`: it owns only the priority domain mapping (icon, label, badge
 * variant, default aria-label) and leans on the single-source {@link priorityOption}; the pill
 * geometry and the clickable `<button>` live in `Badge` (`asButton`).
 */
export function PriorityChip({
  priority,
  className,
  'aria-label': ariaLabel,
  ...properties
}: PriorityChipProperties) {
  const { label, icon: Icon, badgeVariant } = priorityOption(priority);
  return (
    <Badge
      asButton
      variant={badgeVariant}
      interactive
      className={cn('inline-flex items-center gap-1 font-medium hover:opacity-80', className)}
      aria-label={ariaLabel ?? `Priority: ${label}`}
      {...properties}
    >
      <Icon size={10} strokeWidth={2.5} className="shrink-0" />
      {label}
    </Badge>
  );
}
