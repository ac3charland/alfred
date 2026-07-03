/**
 * Pure date helpers used by task-row (and potentially other components).
 * Extracted to a separate module so they can be directly unit-tested without
 * the overhead of rendering a full React component.
 */

export const MONTHS: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Parse an ISO due-date string into a *local* `Date`. Exported so the recurrence engine
 * shares one calendar-date convention with the rest of the app (no UTC shift): a bare
 * `YYYY-MM-DD` (or a midnight-UTC timestamp) is read as local midnight, never the previous
 * local day in negative-UTC timezones. Day arithmetic on the returned local `Date` (read back
 * with the local getters) therefore never drifts across a DST boundary.
 */
export function parseDueDate(iso: string): Date {
  // YYYY-MM-DD and midnight-UTC timestamps both represent UTC midnight, which in
  // negative-UTC timezones (e.g. CDT) is the previous local day. Appending T00:00:00
  // (no Z) forces the engine to treat the calendar date as local midnight.
  if (/^\d{4}-\d{2}-\d{2}(T00:00:00|$)/.test(iso)) {
    return new Date(iso.slice(0, 10) + 'T00:00:00');
  }
  return new Date(iso);
}

/**
 * Format a `Date`'s local calendar date as `Mon D` (abbreviated month + day), e.g. `Aug 1`.
 * Used by the recurrence-rule summary for an absolute end date (`until Aug 1`); unlike
 * {@link formatDueDate} it is never relative ("Today"/"Tomorrow").
 */
export function formatMonthDay(iso: string): string {
  const date = parseDueDate(iso);
  return `${MONTHS[date.getMonth()] ?? ''} ${String(date.getDate())}`;
}

/** Build a `YYYY-MM-DD` string from local year / 0-based month / day numbers. */
export function toISODate(year: number, month0: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month0 + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** One cell of the calendar month grid. */
export interface MonthGridDay {
  /** The cell's local calendar date as `YYYY-MM-DD`. */
  iso: string;
  /** The day-of-month number (1–31) shown in the cell. */
  day: number;
  /** Whether the cell belongs to the month being shown (vs. a leading/trailing spill day). */
  inMonth: boolean;
}

/**
 * The 6×7 (42-cell) calendar grid for a month, starting on Sunday — the data behind the due-date
 * picker's month view. Leading cells fill from the previous month and trailing cells from the
 * next, so every week is complete and the grid height never jumps between months. Pure (local
 * calendar dates via {@link toISODate}) so it unit-tests without rendering.
 */
export function monthGridDays(year: number, month0: number): MonthGridDay[] {
  // The weekday (0=Sun) of the 1st tells us how many leading spill days to prepend.
  const firstOfMonth = new Date(year, month0, 1);
  const leading = firstOfMonth.getDay();
  // Day 0 of the next month is the last day of this month → its date is the day count.
  const cells: MonthGridDay[] = [];
  // Start at the Sunday on/of-before the 1st, then walk 42 consecutive days. Using a Date and
  // incrementing the day handles month/year rollovers (and DST) without manual arithmetic.
  const start = new Date(year, month0, 1 - leading);
  for (let index = 0; index < 42; index += 1) {
    const cell = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    cells.push({
      iso: toISODate(cell.getFullYear(), cell.getMonth(), cell.getDate()),
      day: cell.getDate(),
      inMonth: cell.getMonth() === month0,
    });
  }
  return cells;
}

/** Today's local calendar date as a `YYYY-MM-DD` string (the default recurrence anchor). */
export function todayISODate(): string {
  const now = new Date();
  const y = String(now.getFullYear()).padStart(4, '0');
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns a human-readable label for an ISO due-date string.
 *  - "Today" if the date matches today's local date
 *  - "Tomorrow" / "Yesterday" for ±1 day
 *  - "Mon DD" (abbreviated month + day number) otherwise
 */
export function formatDueDate(iso: string): string {
  const date = parseDueDate(iso);
  const now = new Date();
  const todayString = now.toDateString();
  const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (date.toDateString() === todayString) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  // Stryker disable next-line StringLiteral: AT_CEILING — `date.getMonth()` always returns 0-11, so MONTHS[month] is always defined; the `?? ''` fallback is dead code for the defensive impossible case.
  return `${MONTHS[date.getMonth()] ?? ''} ${String(date.getDate())}`;
}

/**
 * Returns true when the ISO due-date string represents a date strictly before
 * today (i.e. midnight today local time). Today itself is NOT overdue.
 */
export function isDueDateOverdue(iso: string): boolean {
  return parseDueDate(iso) < new Date(new Date().toDateString());
}

/**
 * Returns true when the ISO due-date string represents today (local) or any
 * earlier date. Unlike isDueDateOverdue, today itself counts.
 */
export function isDueTodayOrOverdue(iso: string): boolean {
  // startOfToday = local midnight today; a date-only due date of "today" parses to
  // exactly this, so `<=` includes today and every earlier day, excludes the future.
  return parseDueDate(iso) <= new Date(new Date().toDateString());
}

/**
 * Returns true when the ISO due-date string represents today's local calendar date
 * exactly — the "due today" band that sits between overdue (strictly earlier) and
 * upcoming (strictly later). Composed from the two boundary checks so it shares their
 * timezone-safe parsing: due-today-or-earlier, minus everything strictly earlier.
 */
export function isDueToday(iso: string): boolean {
  return isDueTodayOrOverdue(iso) && !isDueDateOverdue(iso);
}
