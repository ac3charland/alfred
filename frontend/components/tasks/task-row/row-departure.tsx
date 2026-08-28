'use client';

import type * as React from 'react';

import {
  collapseClass,
  collapseInnerClass,
  sendOffClass,
} from '@/components/tasks/task-row.styles';
import { cn } from '@/lib/utils';

interface RowDepartureProperties {
  /** True while this row is being sent off — see the departing-items store. */
  departing: boolean;
  children: React.ReactNode;
}

/**
 * The departure exit for a SELECT-MODE row (ALF-182). That branch of `TaskRow` is its own bare
 * `<li>` — it has none of the full row's exit machinery — yet it is the only shape a dispatched
 * row is ever in, since Dispatch is pressed from the bulk bar with select mode on. So it gets
 * the same two layers the full row's exit uses, on the same classes: the `collapseClass`
 * grid-rows track shrinking 1fr → 0fr (which is what pulls the rows that STAY up into the gap)
 * with the `sendOffClass` slide riding on top, held back by the track's `delay-200` so the row
 * has visibly left before the list closes over it.
 *
 * Both clips are applied only while departing: the grid track needs one to shrink past its
 * content and the wrapper needs one so the rightward slide can't push the page sideways, but at
 * rest a clip would shave the row's focus ring (see the motion skill's overflow-hidden note).
 */
export function RowDeparture({ departing, children }: RowDepartureProperties) {
  return (
    <div
      data-testid="task-collapse"
      className={cn(
        collapseClass,
        departing ? 'grid-rows-[0fr] overflow-hidden' : 'grid-rows-[1fr]',
      )}
    >
      <div className={cn(collapseInnerClass, departing && cn('overflow-hidden', sendOffClass))}>
        {children}
      </div>
    </div>
  );
}
