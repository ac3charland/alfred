/**
 * Calendar-date arithmetic for habits. Everything is a `YYYY-MM-DD` string and every
 * computation goes through UTC field math, so no result depends on the machine's zone —
 * the one place a zone is consulted is {@link todayIn}, which is handed one explicitly.
 */

const MS_PER_DAY = 86_400_000;

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
 * The calendar date it currently is in `timezone`, as `YYYY-MM-DD`. An unrecognized zone
 * degrades to UTC rather than throwing — a habit write must not 500 because a caller sent a
 * typo'd zone. `now` is injected so the boundary cases (either side of local midnight, a DST
 * transition) are testable without touching the clock.
 */
export function todayIn(timezone: string, now: Date = new Date()): string {
  const zone = isValidTimezone(timezone) ? timezone : 'UTC';
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
