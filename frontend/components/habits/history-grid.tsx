'use client';

import * as React from 'react';

import { BottomSheetDialog } from '@/components/atoms/dialog';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/atoms/popover';
import { DayEditor } from '@/components/habits/day-editor';
import {
  beforeStartName,
  dayAccessibleName,
  formatShortDate,
} from '@/components/habits/habit-format';
import { GRID_ROWS, WEEKDAY_LINE } from '@/components/habits/habits.styles';
import { HistoryCell } from '@/components/habits/history-cell';
import {
  APP_WINDOW_DAYS,
  addDays,
  buildHabitCalendar,
  isoWeekday,
  parseCriteria,
  parseResults,
} from '@/lib/habits';
import { TOUCH_QUERY, useMediaQuery } from '@/lib/hooks/use-media-query';
import type { Habit, HabitEntry } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The row labels down the left edge — Monday at the top, every other day named. */
const WEEKDAY_LABELS = ['M', '', 'W', '', 'F', '', 'S'];

interface HistoryGridProperties {
  habit: Habit;
  /** This habit's entries, keyed by date — straight from the store. */
  entries: Record<string, HabitEntry>;
  /** The owner's local today. */
  today: string;
  /** Overridden by stories so a baseline doesn't depend on the real window length. */
  windowDays?: number;
}

/**
 * The history grid: weekdays down, ISO weeks across, so a quarter fits on one screen.
 *
 * The rendered range is padded out to whole weeks at both ends — back to the Monday that
 * starts the window's first week (so every column is a real week and the rows line up) and
 * forward to the Sunday that ends the current one (so today never sits on the trailing edge).
 * The padding days fall outside the habit's life and render as untracked.
 *
 * The newest column is anchored to the RIGHT edge, because the days worth seeing on arrival
 * are the recent ones. Two things get it there and history stays one gesture away:
 * `justify-end` when the quarter fits, and — when it doesn't — a right-to-left scroll strip,
 * whose start edge IS its right one, so the browser opens on today with no script and re-lands
 * there on every resize. Only the squares scroll; the weekday labels sit outside the strip and
 * stay put however far back the columns are pushed.
 *
 * One popover serves the whole grid, positioned against whichever cell is open through a
 * VIRTUAL anchor. That keeps a quarter's worth of cells from each mounting their own popover,
 * and — because no cell's markup changes when the editor opens — the button the editor came
 * from is still the same DOM node when Escape hands focus back to it.
 *
 * On a touch device (a phone-width viewport or a coarse pointer) the same editor opens in a
 * bottom sheet instead, thumb-sized. The squares grow in CSS, so the first paint is already the
 * right size; the container is chosen here, which is safe because the editor only mounts after a
 * tap. One `openDate` and one editor element serve both, so a window resized across the line
 * keeps the same day open in the other container.
 */
export function HistoryGrid({
  habit,
  entries,
  today,
  windowDays = APP_WINDOW_DAYS,
}: HistoryGridProperties) {
  const [openDate, setOpenDate] = React.useState<string | undefined>();
  const openCellRef = React.useRef<HTMLButtonElement | null>(null);
  // A stable virtual anchor that measures whichever cell is open, so the popover positions
  // itself over that cell without any cell having to render a Radix anchor of its own.
  const anchorRef = React.useRef({
    getBoundingClientRect: () => openCellRef.current?.getBoundingClientRect() ?? new DOMRect(),
  });

  const criteria = React.useMemo(() => parseCriteria(habit.criteria), [habit.criteria]);

  const calendar = React.useMemo(() => {
    const windowStart = addDays(today, -(windowDays - 1));
    const from = addDays(windowStart, -(isoWeekday(windowStart) - 1));
    const to = addDays(today, 7 - isoWeekday(today));
    return buildHabitCalendar(habit, Object.values(entries), { from, to, today });
  }, [habit, entries, today, windowDays]);

  const touch = useMediaQuery(TOUCH_QUERY);
  const openEntry = openDate === undefined ? undefined : entries[openDate];

  const close = () => {
    setOpenDate(undefined);
  };
  // Neither container has a trigger to restore focus to — the popover's anchor is virtual and the
  // sheet is opened by state — so send it back to the cell the editor was opened from.
  const returnFocus = (event_: Event) => {
    event_.preventDefault();
    openCellRef.current?.focus();
  };

  const editor = openDate !== undefined && (
    <DayEditor
      habitId={habit.id}
      date={openDate}
      criteria={criteria}
      results={parseResults(openEntry?.results ?? null)}
      storedStatus={openEntry?.status === 'skipped' ? undefined : openEntry?.status}
      isSkipped={openEntry?.status === 'skipped'}
      skipReason={openEntry?.note ?? null}
      isBeforeStart={openDate < habit.started_on}
      onClose={close}
      touch={touch}
      habitName={habit.name}
    />
  );

  return (
    <Popover
      open={!touch && openDate !== undefined}
      onOpenChange={(open) => {
        if (!open) setOpenDate(undefined);
      }}
    >
      {/* `min-w-0` is what lets the grid give way to the stats rail beside it. As a flex item its
          automatic minimum size is its content width — 27 columns of squares — so without this it
          refuses to shrink, the row grows past the card, and the rail (which must not shrink, or
          its figures would wrap) is pushed out through the card's right edge. Allowed to shrink,
          the grid hands the overflow to its own scroller below. */}
      <div className="flex min-w-0 items-start justify-end gap-1.5">
        <div
          aria-hidden="true"
          data-testid="history-weekdays"
          className={cn(
            'grid shrink-0 gap-1.5 py-2 pr-1 text-right text-[10px] text-muted-foreground',
            GRID_ROWS,
          )}
        >
          {WEEKDAY_LABELS.map((label, index) => (
            <span key={index} className={WEEKDAY_LINE}>
              {label}
            </span>
          ))}
        </div>
        <div data-testid="history-scroll" dir="rtl" className="overflow-x-auto">
          <div
            dir="ltr"
            role="group"
            aria-label={`${habit.name} history`}
            // On touch the strip's ends are padded by the hit area's outset, so the outermost
            // columns' targets aren't clipped by the scroller.
            className={cn('grid w-max grid-flow-col gap-1.5 py-2 touch:px-[3px]', GRID_ROWS)}
          >
            {calendar.map((day, index) => (
              <HistoryCell
                key={day.date}
                day={day}
                previousLink={calendar[index - 1]?.link ?? 'none'}
                name={
                  // A loggable day with no verdict is a pre-start one: `canLog` already ruled
                  // out the future, the off-weekday and the archived.
                  day.status === 'not_applicable'
                    ? beforeStartName(day.date)
                    : dayAccessibleName(
                        day.date,
                        day.status,
                        criteria,
                        parseResults(entries[day.date]?.results ?? null),
                        entries[day.date]?.note ?? null,
                      )
                }
                {...(day.canLog
                  ? {
                      onOpen: (event: React.MouseEvent<HTMLButtonElement>) => {
                        openCellRef.current = event.currentTarget;
                        setOpenDate(day.date);
                      },
                    }
                  : {})}
              />
            ))}
          </div>
        </div>
      </div>

      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent className="p-0" onCloseAutoFocus={returnFocus}>
        {!touch && editor}
      </PopoverContent>

      <BottomSheetDialog
        open={touch && openDate !== undefined}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        label={openDate === undefined ? '' : `${formatShortDate(openDate)} — ${habit.name}`}
        onCloseAutoFocus={returnFocus}
      >
        {touch && editor}
      </BottomSheetDialog>
    </Popover>
  );
}
