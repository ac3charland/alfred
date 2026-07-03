import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { formatDueDate, isDueDateOverdue, isDueToday } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

export interface DueDateChipProperties extends Omit<React.HTMLAttributes<HTMLElement>, 'children'> {
  /** ISO date string; rendered via `formatDueDate` and coloured by urgency band. */
  dueDate: string;
}

/**
 * Maps a due date to its {@link Badge} urgency tone: red once overdue, amber the day it's due,
 * blue while still upcoming — matching the folder attention badges' red/amber convention.
 */
function dueDateVariant(dueDate: string): 'overdue' | 'dueToday' | 'due' {
  if (isDueDateOverdue(dueDate)) return 'overdue';
  if (isDueToday(dueDate)) return 'dueToday';
  return 'due';
}

/**
 * The clickable due-date pill on a task row: a due date rendered *as* a clickable {@link Badge}
 * — blue while upcoming, amber the day it's due, red once overdue — opening the due-date editor
 * on click. It owns only the due-date domain mapping (urgency band → tone, `formatDueDate` label,
 * default aria-label); the pill geometry and the clickable `<button>` live in `Badge` (`asButton`),
 * so this stays a lean feature wrapper with no raw element of its own.
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
      variant={dueDateVariant(dueDate)}
      interactive
      className={cn('font-medium', className)}
      aria-label={ariaLabel ?? `Due date: ${dueDate}`}
      {...properties}
    >
      {formatDueDate(dueDate)}
    </Badge>
  );
}
