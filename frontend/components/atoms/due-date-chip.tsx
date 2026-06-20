import * as React from 'react';

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
    return (
      <button
        type={type ?? 'button'}
        aria-label={ariaLabel ?? `Due date: ${dueDate}`}
        className={cn(
          // Stryker disable next-line StringLiteral: AT_CEILING — cosmetic styling, no behavioral effect
          'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors motion-reduce:transition-none',
          isDueDateOverdue(dueDate)
            ? 'border-accent-amber/50 text-accent-amber hover:border-accent-amber'
            : 'border-accent-blue/50 text-accent-blue hover:border-accent-blue',
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
