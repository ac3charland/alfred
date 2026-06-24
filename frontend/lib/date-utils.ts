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
