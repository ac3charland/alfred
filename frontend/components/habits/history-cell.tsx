'use client';

import * as React from 'react';

import { CELL_PLATE, CELL_SHAPE, CELL_TODAY, LINK_TONE } from '@/components/habits/habits.styles';
import { isoWeekday } from '@/lib/habits';
import type { HabitDay } from '@/lib/habits';
import { cn } from '@/lib/utils';

interface HistoryCellProperties {
  day: HabitDay;
  /** The link OUT of the previous calendar day — what a Monday's wrap-in stub inherits. */
  previousLink: HabitDay['link'];
  /** The cell's accessible name: date, verdict, and the day's recorded values. */
  name: string;
  /**
   * Open the day editor on this cell. Absent for a day there is nothing to open — which is
   * what keeps an untracked day out of the tab order. The event carries the button, so the
   * grid can hand focus back to it when the editor closes.
   */
  onOpen?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}

/** The bar between this day and the next, or the half-stub at a column boundary. */
function Connector({ tone, place }: { tone: 'streak' | 'bridge'; place: 'out' | 'wrap-in' }) {
  return (
    <span
      aria-hidden="true"
      data-connector={place}
      data-tone={tone}
      className={cn(
        'pointer-events-none absolute left-1/2 w-[10px] -translate-x-1/2',
        LINK_TONE[tone],
        place === 'out'
          ? 'top-full h-[7px] rounded-b-[3px]'
          : 'bottom-full h-[7px] rounded-t-[3px]',
      )}
    />
  );
}

/**
 * One day of the history grid: a plate carrying the day's verdict, plus the connectors that
 * carry the chain into and out of it.
 *
 * Sunday sits at the bottom of one column and the next Monday at the top of the next, so no
 * bar can join them — each grows a half-stub pointing outward instead. Without it the chain
 * appears to break every week, which is the one thing this visualization exists to say
 * correctly.
 *
 * Nothing here decides whether a link is earned or forgiven: the streak walk already said so
 * in `HabitDay.link`, and the cell renders exactly that.
 */
export function HistoryCell({ day, previousLink, name, onOpen }: HistoryCellProperties) {
  const outTone = day.link === 'none' ? undefined : day.link;
  // A Monday inherits the tone of the link that reached it from the preceding Sunday.
  const inTone = isoWeekday(day.date) === 1 && previousLink !== 'none' ? previousLink : undefined;

  const shape = CELL_SHAPE[day.status];

  const plate = (
    <span
      className={cn(
        'relative block h-full w-full rounded-md',
        CELL_PLATE[day.status],
        day.isToday && CELL_TODAY,
      )}
    >
      {shape !== '' && <span aria-hidden="true" className={cn('absolute', shape)} />}
      {day.status === 'skipped' && (
        <span
          aria-hidden="true"
          className="absolute inset-0 flex items-center justify-center text-[13px] leading-none text-muted-foreground"
        >
          –
        </span>
      )}
    </span>
  );

  const button = (
    <button
      type="button"
      aria-label={name}
      title={name}
      onClick={onOpen}
      className={cn(
        'block h-full w-full rounded-md',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-teal focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      )}
    >
      {plate}
    </button>
  );

  return (
    <div
      className="relative h-[26px] w-[26px]"
      data-date={day.date}
      data-status={day.status}
      data-in-streak={day.inStreak ? 'true' : 'false'}
    >
      {inTone !== undefined && <Connector tone={inTone} place="wrap-in" />}
      {outTone !== undefined && <Connector tone={outTone} place="out" />}
      {onOpen === undefined ? (
        // Nothing to open on an untracked day, so it stays out of the tab order and carries no
        // name — a screen reader would only be reading out padding.
        <span aria-hidden="true" className="block h-full w-full">
          {plate}
        </span>
      ) : (
        button
      )}
    </div>
  );
}
