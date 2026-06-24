import { Repeat } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/components/atoms/badge';
import { summarizeRule } from '@/lib/recurrence';
import type { RecurrenceRule } from '@/lib/recurrence';
import { cn } from '@/lib/utils';

export interface RecurrenceChipProperties extends Omit<
  React.HTMLAttributes<HTMLElement>,
  'children'
> {
  /** The rule to summarize (e.g. `"Every 2 weeks on Mon, Wed"`). */
  rule: RecurrenceRule;
}

/**
 * The recurrence pill on a task row: a {@link Repeat} icon + the rule's human summary, rendered
 * as a clickable {@link Badge} that opens the repeat editor. Sits alongside the due-date chip so
 * a recurring task reads as repeating without expanding. Owns only the recurrence domain mapping
 * (the icon, `summarizeRule`, the default aria-label); the pill geometry and the `<button>` live
 * in `Badge` (`asButton`).
 */
export function RecurrenceChip({
  rule,
  className,
  'aria-label': ariaLabel,
  ...properties
}: RecurrenceChipProperties) {
  const summary = summarizeRule(rule);
  return (
    <Badge
      asButton
      variant="accent"
      interactive
      className={cn(
        'inline-flex items-center gap-1 font-medium hover:bg-accent-teal/25',
        className,
      )}
      aria-label={ariaLabel ?? `Repeats: ${summary}`}
      {...properties}
    >
      <Repeat size={10} strokeWidth={2.5} className="shrink-0" />
      {summary}
    </Badge>
  );
}
