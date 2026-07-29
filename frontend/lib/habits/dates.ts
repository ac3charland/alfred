/**
 * Calendar-date arithmetic for habits. Everything is a `YYYY-MM-DD` string and every
 * computation goes through UTC field math, so no result depends on the machine's zone —
 * the one place a zone is consulted is {@link todayIn}, which is handed one explicitly.
 */

const MS_PER_DAY = 86_400_000;

/** The trailing span a read covers when the caller names no `from`/`to` — a quarter. */
export const DEFAULT_WINDOW_DAYS = 90;

/** The widest span a caller may ask for. Beyond this the answer is refused, never trimmed. */
export const MAX_WINDOW_DAYS = 366;

/**
 * The trailing span the app itself holds: the shell seeds this many days of entries, the grid
 * draws them, and the stats rail's window figures are measured over exactly them. One
 * definition for all three, so a reviewer can count the squares beside a hit rate and arrive at
 * the rail's percentage.
 */
export const APP_WINDOW_DAYS = 120;

/** `Intl.DateTimeFormat` throws on an unknown zone, which is exactly the validity test. */
function isValidTimezone(timezone: string): boolean {
  if (timezone === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone that will actually be used: `timezone` when it is a valid IANA zone, else `UTC`.
 *
 * Split out from {@link todayIn} so a caller can REPORT the fallback. Echoing the zone the
 * request asked for would tell a caller who sent a typo that their days were bucketed in a
 * zone they never got, which is exactly the misreading the fallback is meant to avoid.
 */
export function resolveTimezone(timezone: string): string {
  return isValidTimezone(timezone) ? timezone : 'UTC';
}

/**
 * The calendar date it currently is in `timezone`, as `YYYY-MM-DD`. An unrecognized zone
 * degrades to UTC rather than throwing — a habit write must not 500 because a caller sent a
 * typo'd zone. `now` is injected so the boundary cases (either side of local midnight, a DST
 * transition) are testable without touching the clock.
 */
export function todayIn(timezone: string, now: Date = new Date()): string {
  const zone = resolveTimezone(timezone);
  const parts = new Map(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  return `${parts.get('year') ?? '1970'}-${parts.get('month') ?? '01'}-${parts.get('day') ?? '01'}`;
}

/** The UTC instant standing for a calendar date's midnight — the anchor all day math uses. */
function toUtcMillis(date: string): number {
  const [year = '1970', month = '01', day = '01'] = date.split('-');
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

/** Render a UTC instant back to `YYYY-MM-DD`. */
function fromUtcMillis(millis: number): string {
  return new Date(millis).toISOString().slice(0, 10);
}

/** ISO weekday, 1 = Monday … 7 = Sunday (the numbering `habits.active_days` stores). */
export function isoWeekday(date: string): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const day = new Date(toUtcMillis(date)).getUTCDay();
  return (day === 0 ? 7 : day) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

/** The calendar date `delta` days after `date` (negative goes back). */
export function addDays(date: string, delta: number): string {
  return fromUtcMillis(toUtcMillis(date) + delta * MS_PER_DAY);
}

/** Every calendar date in `[from, to]`, inclusive. Empty when `to` precedes `from`. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) days.push(cursor);
  return days;
}

/** Whole days from `from` to `to` (negative when `to` precedes `from`). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMillis(to) - toUtcMillis(from)) / MS_PER_DAY);
}

/** An inclusive span of calendar days, both ends `YYYY-MM-DD`. */
export interface DateWindow {
  from: string;
  to: string;
}

/**
 * The app's own trailing window ending on `today` — {@link APP_WINDOW_DAYS} days, inclusive of
 * both ends. Handed a browser's local today it names exactly the span the grid draws.
 */
export function appWindow(today: string): DateWindow {
  return { from: addDays(today, -(APP_WINDOW_DAYS - 1)), to: today };
}

/**
 * Resolve a requested `[from, to]` against `today`, or explain why it can't be.
 *
 * Two rules bend and two refuse, and the split is deliberate. A `to` past today is pulled
 * back, so the obvious "give me this quarter" call keeps working after quarter-end; an absent
 * end or start defaults to today and the trailing {@link DEFAULT_WINDOW_DAYS}. But a `from`
 * after `to` names no span at all, and one wider than {@link MAX_WINDOW_DAYS} names a span
 * this read won't serve — guessing at either would answer a question nobody asked.
 *
 * `from` is checked against the CLAMPED `to`, so "from tomorrow to next week" is rejected
 * rather than silently becoming a backwards window.
 */
export function resolveWindow(
  query: { from?: string | undefined; to?: string | undefined },
  today: string,
): DateWindow | { error: string } {
  const requestedTo = query.to ?? today;
  const to = requestedTo > today ? today : requestedTo;
  const from = query.from ?? addDays(to, -(DEFAULT_WINDOW_DAYS - 1));

  if (from > to) return { error: '`from` must not be after `to`' };
  if (daysBetween(from, to) + 1 > MAX_WINDOW_DAYS) {
    return { error: `The window must not exceed ${String(MAX_WINDOW_DAYS)} days` };
  }
  return { from, to };
}
