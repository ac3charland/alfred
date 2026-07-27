/**
 * The rolling seven-day window the PR-ratio count is measured over.
 *
 * Pure and clock-free (the caller injects `now`), because this is the one piece of the
 * PR-ratio feature with real edge cases — DST and negative-UTC offsets — and it is cheaper to
 * unit-test a function than to reason about them in a Route Handler.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_WEEK = 604_800_000;

/**
 * The window's ends are floored to this many seconds, and the GitHub responses are cached for
 * the same span — one constant, because they have to agree.
 *
 * A window ending at an exact `now` would put a different timestamp in every search URL, so
 * the fetch cache could never hit and each Backlog visit would spend fresh calls against a
 * 30-req/min quota. Flooring to a shared bucket makes the query identical for as long as the
 * cached response is good for, at the cost of an end up to five minutes behind the clock.
 */
export const WINDOW_GRANULARITY_SECONDS = 300;

export interface WeekWindow {
  /** ISO 8601 with offset, e.g. '2026-07-17T16:00:00-04:00' — seven days before `end`. */
  start: string;
  /** ISO 8601 with offset — the instant the request was made. */
  end: string;
  /** The IANA timezone the window's timestamps are rendered in. */
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
 * Deriving it per-instant is what makes a window spanning a DST change come out right: each
 * end is stamped with the offset in force there, so the span stays a true seven days.
 */
function offsetMinutes(instant: Date, timezone: string): number {
  const { year, month, day, hour, minute, second } = zonedParts(instant, timezone);
  const asIfUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // The formatter drops sub-second precision, so compare against a whole-second instant.
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return (asIfUtc - truncated) / MS_PER_MINUTE;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** `2026-07-17T16:00:00-04:00` — the offset-bearing form GitHub's `merged:` qualifier takes. */
function formatWithOffset(instant: Date, timezone: string): string {
  const offset = offsetMinutes(instant, timezone);
  const wallClock = new Date(instant.getTime() + offset * MS_PER_MINUTE);
  const sign = offset < 0 ? '-' : '+';
  const absolute = Math.abs(offset);
  // `slice(0, 19)` drops the milliseconds, which the qualifier has no room for.
  return `${wallClock.toISOString().slice(0, 19)}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`;
}

/**
 * The seven days ending at `now`, expressed in `timezone`.
 *
 * Rolling rather than Monday-anchored: the weekly review happens on a Friday afternoon, and
 * sometimes slips to a Sunday, so a calendar week ending the following Monday would have
 * shown a review only the days since Monday — silently dropping the weekend that just
 * passed. Anchoring on the request instant makes every review see the same seven days of
 * work, whenever it is held.
 *
 * The window is the same 168 hours of real time in every zone; `timezone` only decides the
 * wall clock and offset the two ends are rendered in. Falls back to 'UTC' when it is not a
 * valid IANA zone — never throws, because the endpoint's job is to return a number, not to
 * validate timezones.
 *
 * `now` is floored to the enclosing {@link WINDOW_GRANULARITY_SECONDS} bucket; see that
 * constant for why.
 */
export function rollingWeekWindow(now: Date, timezone: string): WeekWindow {
  const zone = isValidTimezone(timezone) ? timezone : 'UTC';
  const bucket = WINDOW_GRANULARITY_SECONDS * 1000;
  const end = new Date(Math.floor(now.getTime() / bucket) * bucket);
  const start = new Date(end.getTime() - MS_PER_WEEK);

  return {
    start: formatWithOffset(start, zone),
    end: formatWithOffset(end, zone),
    timezone: zone,
  };
}
