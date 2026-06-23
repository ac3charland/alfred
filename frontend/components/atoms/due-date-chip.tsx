import * as React from 'react';

import { badgeVariants } from '@/components/atoms/badge';
import { formatDueDate, isDueDateOverdue } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

export interface DueDateChipProperties extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  /** ISO date string; rendered via `formatDueDate` and coloured amber when overdue. */
  dueDate: string;
}

/**
 * The clickable due-date pill on a task row: a small `rounded-full` chip that reads blue
 * normally and amber once overdue, opening the due-date editor on click. The `aria-label`
 * defaults to `Due date: <iso>` and can be overridden.
 *
 * Defaults to `type="button"` so it never submits a surrounding form.
 */
const DueDateChip = React.forwardRef<HTMLButtonElement, DueDateChipProperties>(
  ({ dueDate, className, type, 'aria-label': ariaLabel, ...properties }, reference) => {
    const overdue = isDueDateOverdue(dueDate);
    return (
      <button
        type={type ?? 'button'}
        aria-label={ariaLabel ?? `Due date: ${dueDate}`}
        className={cn(
          badgeVariants({ variant: overdue ? 'warning' : 'info' }),
          'font-medium transition-colors motion-reduce:transition-none',
          overdue ? 'hover:border-accent-amber' : 'hover:border-accent-blue',
          className,
        )}
        ref={reference}
        {...properties}
      >
        {formatDueDate(dueDate)}
      </button>
    );
  },
);
DueDateChip.displayName = 'DueDateChip';

export { DueDateChip };
