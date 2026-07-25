/**
 * The ISO-week window the PR-ratio count is measured over.
 *
 * Pure and clock-free (the caller injects `now`), because this is the one piece of the
 * PR-ratio feature with real edge cases — DST, negative-UTC offsets, and Sunday — and it is
 * cheaper to unit-test a function than to reason about them in a Route Handler.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

export interface WeekWindow {
  /** ISO 8601 with offset, e.g. '2026-07-20T00:00:00-04:00' — inclusive. */
  start: string;
  /** ISO 8601 with offset — EXCLUSIVE (the following Monday's midnight). */
  end: string;
  /** The IANA timezone the window was computed in. */
  timezone: string;
}

/** Local wall-clock fields of one instant, as seen in a given timezone. */
interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

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

function zonedFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    // h23 so midnight reads as hour 0, not the hour-24 en-US would otherwise emit.
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** The wall-clock fields `instant` shows in `timezone`. */
function zonedParts(instant: Date, timezone: string): ZonedParts {
  const parts = new Map(
    zonedFormatter(timezone)
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const field = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.get(type) ?? '0');
  return {
    year: field('year'),
    month: field('month'),
    day: field('day'),
    hour: field('hour'),
    minute: field('minute'),
    second: field('second'),
  };
}

/**
 * The zone's UTC offset (in minutes, east-positive) at a given instant — derived by reading
 * the wall clock in that zone and asking how far it sits from the same fields read as UTC.
 * Deriving it per-instant is what makes a week spanning a DST change come out right.
 */
function offsetMinutes(instant: Date, timezone: string): number {
  const { year, month, day, hour, minute, second } = zonedParts(instant, timezone);
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // The formatter drops sub-second precision, so compare against a whole-second instant.
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return (asIfUtc - truncated) / MS_PER_MINUTE;
}

/**
 * The instant at which a given local calendar date begins (00:00:00) in `timezone`.
 *
 * Solved by iteration rather than algebra: the offset to subtract depends on the instant we
 * are trying to find. One refinement pass settles it, including the DST weeks where the first
 * guess lands on the wrong side of the transition.
 */
function startOfLocalDay(year: number, month: number, day: number, timezone: string): Date {
  const naive = Date.UTC(year, month - 1, day);
  let instant = naive - offsetMinutes(new Date(naive), timezone) * MS_PER_MINUTE;
  instant = naive - offsetMinutes(new Date(instant), timezone) * MS_PER_MINUTE;
  return new Date(instant);
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `2026-07-20T00:00:00-04:00` — the offset-bearing form GitHub's `merged:` qualifier takes. */
function formatWithOffset(instant: Date, timezone: string): string {
  const offset = offsetMinutes(instant, timezone);
  const wallClock = new Date(instant.getTime() + offset * MS_PER_MINUTE);
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  return `${wallClock.toISOString().slice(0, 19)}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/**
 * The ISO week (Monday 00:00 → next Monday 00:00) containing `now`, expressed in `timezone`.
 * Falls back to 'UTC' when `timezone` is not a valid IANA zone — never throws, because the
 * endpoint's job is to return a number, not to validate timezones.
 */
export function isoWeekWindow(now: Date, timezone: string): WeekWindow {
  const zone = isValidTimezone(timezone) ? timezone : 'UTC';
  const { year, month, day } = zonedParts(now, zone);

  // Weekday of the local calendar date, read off a UTC instant so no offset is involved.
  const localDate = Date.UTC(year, month - 1, day);
  const daysSinceMonday = (new Date(localDate).getUTCDay() + 6) % 7;
  const monday = new Date(localDate - daysSinceMonday * MS_PER_DAY);
  const nextMonday = new Date(monday.getTime() + 7 * MS_PER_DAY);

  const start = startOfLocalDay(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    zone,
  );
  const end = startOfLocalDay(
    nextMonday.getUTCFullYear(),
    nextMonday.getUTCMonth() + 1,
    nextMonday.getUTCDate(),
    zone,
  );

  return {
    start: formatWithOffset(start, zone),
    end: formatWithOffset(end, zone),
    timezone: zone,
  };
}
