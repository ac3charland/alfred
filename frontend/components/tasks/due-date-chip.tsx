import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { formatDueDate, isDueDateOverdue } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

export interface DueDateChipProperties extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  /** ISO date string; rendered via `formatDueDate` and coloured amber when overdue. */
  dueDate: string;
}

/**
 * The clickable due-date pill on a task row: a due date rendered *as* a clickable {@link Badge}
 * — blue normally, amber once overdue — opening the due-date editor on click. It owns only the
 * due-date domain mapping (overdue → tone, `formatDueDate` label, default aria-label); the pill
 * geometry and the clickable `<button>` live in `Badge` (`asButton`), so this stays a lean
 * feature wrapper with no raw element of its own.
 *
 * The `aria-label` defaults to `Due date: <iso>` and can be overridden. `Badge` renders it as a
 * `type="button"`, so it never submits a surrounding form.
 */
export function DueDateChip({
  dueDate,
  className,
  'aria-label': ariaLabel,
  ...properties
}: DueDateChipProperties) {
  return (
    <Badge
      asButton
      variant={isDueDateOverdue(dueDate) ? 'overdue' : 'due'}
      interactive
      className={cn('font-medium', className)}
      aria-label={ariaLabel ?? `Due date: ${dueDate}`}
      {...properties}
    >
      {formatDueDate(dueDate)}
    </Badge>
  );
}
