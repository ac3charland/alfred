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

/** Milliseconds in a calendar day — the step every UTC-field date computation below takes. */
const MS_PER_DAY = 86_400_000;

/**
 * The UTC instant standing for a calendar date's midnight — the anchor all calendar-date
 * arithmetic uses. Exported for the habit helpers that share this convention (`isoWeekday`,
 * `daysBetween`), so there is one definition of "what instant is this date".
 */
export function toUtcMillis(date: string): number {
  const [year = '1970', month = '01', day = '01'] = date.split('-');
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

/** Render a UTC instant back to `YYYY-MM-DD`. */
export function fromUtcMillis(millis: number): string {
  return new Date(millis).toISOString().slice(0, 10);
}

/**
 * The calendar date `delta` days after `date` (negative goes back). Both ends are
 * `YYYY-MM-DD`, and the arithmetic runs in UTC fields, so no result depends on the machine's
 * zone. **The input must be date-only**: a full timestamp splits on its `-` separators into
 * nonsense (`Number('04T00:00:00+00:00')` is `NaN`), so normalise a `timestamptz` column with
 * `.slice(0, 10)` before calling.
 */
export function addDays(date: string, delta: number): string {
  return fromUtcMillis(toUtcMillis(date) + delta * MS_PER_DAY);
}

/** An instant's local calendar date as a `YYYY-MM-DD` string. */
export function localISODate(instant: Date): string {
  return toISODate(instant.getFullYear(), instant.getMonth(), instant.getDate());
}

/** Today's local calendar date as a `YYYY-MM-DD` string (the default recurrence anchor). */
export function todayISODate(): string {
  return localISODate(new Date());
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

// ---------------------------------------------------------------------------
// Due times — a wall-clock "floating" time beside a due date
// ---------------------------------------------------------------------------
//
// `items.due_time` is a zone-less wall-clock time, meaningful only beside `due_date`: 3 PM means
// 3 PM on whatever device reads it. The API speaks 24-hour `HH:MM`; PostgREST hands a `time`
// back as `HH:MM:SS`, so every reader goes through {@link normalizeDueTime} before comparing.

/**
 * A stored due time as `HH:MM`, or null when the task has none. `undefined` reads as none too: a
 * read path that predates the column (a `select i.*` view not yet recreated) yields `undefined`
 * where the row type promises `string | null`.
 */
export function normalizeDueTime(time: string | null | undefined): string | null {
  return time === null || time === undefined ? null : time.slice(0, 5);
}

/** Split an `HH:MM` (or `HH:MM:SS`) time into its hour and minute numbers. */
function timeParts(time: string): { hour: number; minute: number } {
  const [hour = '0', minute = '0'] = time.split(':');
  return { hour: Number(hour), minute: Number(minute) };
}

/**
 * A due time in the device's clock format, with the minutes dropped on the hour: en-US reads
 * `15:00` as "3 PM" and `09:30` as "9:30 AM"; a 24-hour locale reads them "15" and "09:30".
 * `locale` defaults to the runtime's own (tests pin it).
 */
export function formatDueTime(time: string, locale?: string): string {
  const { hour, minute } = timeParts(time);
  const format = new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    ...(minute !== 0 && { minute: '2-digit' }),
  });
  return format.format(new Date(2000, 0, 1, hour, minute));
}

/** A due chip's text: the date label ("Tomorrow"), plus the time when there is one. */
export function formatDueLabel(date: string, time: string | null, locale?: string): string {
  const day = formatDueDate(date);
  return time === null ? day : `${day} ${formatDueTime(time, locale)}`;
}

/**
 * The local instant a task falls due — the ordering key every task sort reads. A timed task falls
 * due at its minute; an untimed one at the last millisecond of its day, so it sorts after that
 * day's timed tasks ("by end of day") and still before anything due the next day.
 */
export function dueMoment(date: string, time: string | null): Date {
  const day = parseDueDate(date);
  if (time === null) {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
  }
  const { hour, minute } = timeParts(time);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
}

/**
 * Whether a task is late at `now`. A timed task is late from its minute onward; an untimed one
 * keeps the day rule — late only once its whole day has passed (see {@link isDueDateOverdue}).
 */
export function isPastDue(date: string, time: string | null, now: Date): boolean {
  if (time === null) {
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return parseDueDate(date) < startOfToday;
  }
  return dueMoment(date, time) <= now;
}

/**
 * The instant to judge lateness by while a timed surface may still be hydrating. A server renders
 * with its own clock in its own zone, and React keeps server-rendered attributes through
 * hydration, so a minute-precise band computed there would stick on screen until the next tick.
 * Until hydration ends, judge by the start of `now`'s day instead — the day rule, which server and
 * browser agree on — and switch to the real minute straight after.
 */
export function lateness(now: Date, hydrated: boolean): Date {
  return hydrated ? now : new Date(now.getFullYear(), now.getMonth(), now.getDate());
}
