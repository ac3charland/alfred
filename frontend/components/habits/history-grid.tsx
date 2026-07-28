'use client';

import * as React from 'react';

import { Popover, PopoverAnchor, PopoverContent } from '@/components/atoms/popover';
import { DayEditor } from '@/components/habits/day-editor';
import { dayAccessibleName } from '@/components/habits/habit-format';
import { HistoryCell } from '@/components/habits/history-cell';
import { addDays, buildHabitCalendar, isoWeekday, parseCriteria, parseResults } from '@/lib/habits';
import type { Habit, HabitEntry } from '@/lib/types';

/** The row labels down the left edge — Monday at the top, every other day named. */
const WEEKDAY_LABELS = ['M', '', 'W', '', 'F', '', 'S'];

/** How far back the grid draws, matching the window the shell seeds. */
export const GRID_WINDOW_DAYS = 120;

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
 * One popover serves the whole grid, positioned against whichever cell is open through a
 * VIRTUAL anchor. That keeps a quarter's worth of cells from each mounting their own popover,
 * and — because no cell's markup changes when the editor opens — the button the editor came
 * from is still the same DOM node when Escape hands focus back to it.
 */
export function HistoryGrid({
  habit,
  entries,
  today,
  windowDays = GRID_WINDOW_DAYS,
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

  const openEntry = openDate === undefined ? undefined : entries[openDate];

  return (
    <Popover
      open={openDate !== undefined}
      onOpenChange={(open) => {
        if (!open) setOpenDate(undefined);
      }}
    >
      <div className="overflow-x-auto">
        <div className="flex items-start gap-1.5">
          <div
            aria-hidden="true"
            className="grid grid-rows-[repeat(7,26px)] gap-1.5 py-2 pr-1 text-right text-[10px] text-muted-foreground"
          >
            {WEEKDAY_LABELS.map((label, index) => (
              <span key={index} className="leading-[26px]">
                {label}
              </span>
            ))}
          </div>
          <div
            role="group"
            aria-label={`${habit.name} history`}
            className="grid w-max grid-flow-col grid-rows-[repeat(7,26px)] gap-1.5 py-2"
          >
            {calendar.map((day, index) => (
              <HistoryCell
                key={day.date}
                day={day}
                previousLink={calendar[index - 1]?.link ?? 'none'}
                name={dayAccessibleName(
                  day.date,
                  day.status,
                  criteria,
                  parseResults(entries[day.date]?.results ?? null),
                  entries[day.date]?.note ?? null,
                )}
                {...(day.status === 'not_applicable'
                  ? {}
                  : {
                      onOpen: (event: React.MouseEvent<HTMLButtonElement>) => {
                        openCellRef.current = event.currentTarget;
                        setOpenDate(day.date);
                      },
                    })}
              />
            ))}
          </div>
        </div>
      </div>

      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        className="p-0"
        onCloseAutoFocus={(event_) => {
          // A virtual anchor is not a trigger, so Radix has nothing to restore focus to —
          // send it back to the cell the editor was opened from.
          event_.preventDefault();
          openCellRef.current?.focus();
        }}
      >
        {openDate !== undefined && (
          <DayEditor
            habitId={habit.id}
            date={openDate}
            criteria={criteria}
            results={parseResults(openEntry?.results ?? null)}
            isSkipped={openEntry?.status === 'skipped'}
            onClose={() => {
              setOpenDate(undefined);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
