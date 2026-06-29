'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import * as React from 'react';

import { IconButton } from '@/components/atoms/icon-button';
import { monthGridDays, parseDueDate, todayISODate } from '@/lib/date-utils';
import { cn } from '@/lib/utils';

interface CalendarProperties {
  /** The currently-selected date (`YYYY-MM-DD`), or null when none is set. */
  selected: string | null;
  /** Apply a picked date. */
  onSelect: (iso: string) => void;
  /** Clear the date entirely (the footer's "Clear"). */
  onClear: () => void;
}

const DAY_HEADERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

/**
 * Full month name + day for a day cell's accessible label (e.g. `July 2, 2025`).
 * Long-form so screen-reader users hear an unambiguous date, not a bare number.
 */
const FULL_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The due-date picker's month-grid calendar (the design's "Due → calendar" popover). A header
 * with prev/next month navigation, a 7-column Sunday-first grid built by the pure
 * {@link monthGridDays}, and a Clear / Today footer. The selected day reads filled-blue, today
 * reads tinted-blue, in-month days are bright and spill days dim — matching the spec's tints.
 *
 * Stateless about persistence: it reports picks via `onSelect` / `onClear` and lets the caller
 * auto-save. Only the *visible* month is local state, seeded from the selection (or today).
 */
export function Calendar({ selected, onSelect, onClear }: CalendarProperties) {
  const today = todayISODate();
  // The month in view — seeded from the selection so opening a dated chip lands on its month.
  const [view, setView] = React.useState(() => {
    const anchor = parseDueDate(selected ?? today);
    return { year: anchor.getFullYear(), month: anchor.getMonth() };
  });

  const cells = React.useMemo(() => monthGridDays(view.year, view.month), [view]);

  const step = (delta: number) => {
    setView((current) => {
      const next = new Date(current.year, current.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  return (
    <div className="w-64 p-2">
      {/* Header: month + year, with prev/next navigation. */}
      <div className="flex items-center justify-between px-1 pb-2">
        <IconButton
          size="sm"
          aria-label="Previous month"
          onClick={() => {
            step(-1);
          }}
        >
          <ChevronLeft size={16} />
        </IconButton>
        <span className="text-sm font-medium text-foreground">
          {`${FULL_MONTHS[view.month] ?? ''} ${String(view.year)}`}
        </span>
        <IconButton
          size="sm"
          aria-label="Next month"
          onClick={() => {
            step(1);
          }}
        >
          <ChevronRight size={16} />
        </IconButton>
      </div>

      {/* Weekday headers. */}
      <div className="grid grid-cols-7 gap-0.5 px-1 pb-1">
        {DAY_HEADERS.map((label, index) => (
          <span
            key={index}
            aria-hidden="true"
            className="flex h-6 items-center justify-center text-[11px] font-medium text-[#5A677C]"
          >
            {label}
          </span>
        ))}
      </div>

      {/* Day grid. */}
      <div className="grid grid-cols-7 gap-0.5 px-1">
        {cells.map((cell) => {
          const isToday = cell.iso === today;
          const isSelected = cell.iso === selected;
          return (
            <button
              key={cell.iso}
              type="button"
              aria-label={`${FULL_MONTHS[parseDueDate(cell.iso).getMonth()] ?? ''} ${String(cell.day)}, ${cell.iso.slice(0, 4)}`}
              aria-pressed={isSelected}
              onClick={() => {
                onSelect(cell.iso);
              }}
              className={cn(
                'flex h-8 items-center justify-center rounded-md text-[13px] transition-colors motion-reduce:transition-none',
                'hover:bg-white/[0.07]',
                isSelected
                  ? 'bg-accent-blue font-semibold text-background'
                  : isToday
                    ? 'bg-[rgba(96,165,250,0.28)] font-semibold text-white'
                    : cell.inMonth
                      ? 'text-[#cdd6e4]'
                      : 'text-[#46526c]',
              )}
            >
              {cell.day}
            </button>
          );
        })}
      </div>

      {/* Footer: Clear (left) · Today (right). */}
      <div className="mt-2 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={onClear}
          className="rounded px-2 py-1 text-xs font-medium text-accent-blue hover:bg-white/[0.06]"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => {
            onSelect(today);
          }}
          className="rounded px-2 py-1 text-xs font-medium text-accent-blue hover:bg-white/[0.06]"
        >
          Today
        </button>
      </div>
    </div>
  );
}
