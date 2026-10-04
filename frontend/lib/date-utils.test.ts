import { pinClock, setClockNow } from '@/lib/pin-clock';

import {
  MONTHS,
  addDays,
  dueMoment,
  formatDueDate,
  formatDueLabel,
  formatDueTime,
  isDueDateOverdue,
  isDueToday,
  isDueTodayOrOverdue,
  isPastDue,
  lateness,
  localISODate,
  monthGridDays,
  normalizeDueTime,
  toISODate,
  todayISODate,
} from './date-utils';

pinClock('2026-07-28T12:00:00.000Z');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a YYYY-MM-DD string for the given local calendar date. After the
 * parseDueDate fix, date-utils treats YYYY-MM-DD as local midnight, so this
 * no longer needs the UTC-offset workaround that was here previously.
 */
function localDueDate(year: number, month0: number, day: number): string {
  return `${String(year)}-${String(month0 + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Returns today's YYYY-MM-DD string in the local timezone. */
function todayLocalYMD(): string {
  const d = new Date();
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Returns the due_date ISO string that formatDueDate() will treat as offsetDays
 * from today (0 = Today, 1 = Tomorrow, -1 = Yesterday).
 *
 * Uses a full datetime ISO string (not a date-only string) so that:
 *  - The "Today" check (toDateString equality) works at any time of day.
 *  - The diffDays check (Math.ceil of ms delta / 24h) reliably gives ±1.
 *
 * For ±1: shifting exactly ±24 h from now gives ceil(±24h/24h) = ±1, and the
 * toDateString will be the adjacent day's (not today's). This is robust at any
 * time of day, unlike YYYY-MM-DD strings that are parsed as UTC midnight and can
 * land in the wrong local day near local midnight.
 */
function dueForDayOffset(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// MONTHS constant
// ---------------------------------------------------------------------------

describe('MONTHS', () => {
  it('has exactly 12 entries', () => {
    expect(MONTHS).toHaveLength(12);
  });

  it.each([
    [0, 'Jan'],
    [1, 'Feb'],
    [2, 'Mar'],
    [3, 'Apr'],
    [4, 'May'],
    [5, 'Jun'],
    [6, 'Jul'],
    [7, 'Aug'],
    [8, 'Sep'],
    [9, 'Oct'],
    [10, 'Nov'],
    [11, 'Dec'],
  ])('MONTHS[%i] is %s', (index, expected) => {
    expect(MONTHS[index]).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// formatDueDate
// ---------------------------------------------------------------------------

describe('formatDueDate', () => {
  it('returns "Today" for today\'s date', () => {
    expect(formatDueDate(dueForDayOffset(0))).toBe('Today');
  });

  it('returns "Tomorrow" for one day in the future', () => {
    expect(formatDueDate(dueForDayOffset(1))).toBe('Tomorrow');
  });

  it('returns "Yesterday" for one day in the past', () => {
    expect(formatDueDate(dueForDayOffset(-1))).toBe('Yesterday');
  });

  it.each([
    [0, 20, 'Jan 20'],
    [1, 10, 'Feb 10'],
    [2, 5, 'Mar 5'],
    [3, 8, 'Apr 8'],
    [4, 1, 'May 1'],
    [5, 20, 'Jun 20'],
    [6, 4, 'Jul 4'],
    [7, 25, 'Aug 25'],
    [8, 10, 'Sep 10'],
    [9, 31, 'Oct 31'],
    [10, 11, 'Nov 11'],
    [11, 25, 'Dec 25'],
  ])('returns "%s" for month %i, day %i', (month0, day, expected) => {
    expect(formatDueDate(localDueDate(2025, month0, day))).toBe(expected);
  });

  it('returns the abbreviated month + day for a date more than 1 day away', () => {
    // 10 days in the future → month + day label
    const label = formatDueDate(dueForDayOffset(10));
    expect(label).not.toBe('Today');
    expect(label).not.toBe('Tomorrow');
    expect(label).not.toBe('Yesterday');
    expect(label).toMatch(/^[A-Z][a-z]{2} \d+$/);
  });

  // Timezone regression: YYYY-MM-DD strings (what <input type="date"> produces and
  // what the DB stores) must be treated as local midnight, not UTC midnight. In
  // negative-UTC timezones (e.g. CDT = UTC-5), UTC midnight is the previous local
  // day, causing off-by-one display bugs (today's date shows as "yesterday").
  it('returns "Today" when given today\'s local date as a YYYY-MM-DD string', () => {
    expect(formatDueDate(todayLocalYMD())).toBe('Today');
  });

  it('returns the correct month and day for a YYYY-MM-DD date string', () => {
    // Jun 20 2025 in local time — must not shift to Jun 19 in negative-UTC zones.
    expect(formatDueDate(localDueDate(2025, 5, 20))).toBe('Jun 20');
  });
});

// ---------------------------------------------------------------------------
// isDueDateOverdue
// ---------------------------------------------------------------------------

describe('isDueDateOverdue', () => {
  it('returns false for today (today is NOT overdue)', () => {
    expect(isDueDateOverdue(dueForDayOffset(0))).toBe(false);
  });

  it('returns false for a date in the future', () => {
    expect(isDueDateOverdue(dueForDayOffset(1))).toBe(false);
    expect(isDueDateOverdue(dueForDayOffset(10))).toBe(false);
  });

  it('returns true for yesterday', () => {
    expect(isDueDateOverdue(dueForDayOffset(-1))).toBe(true);
  });

  it('returns true for a date in the past', () => {
    expect(isDueDateOverdue(dueForDayOffset(-10))).toBe(true);
  });

  it('uses strict less-than (not <=): a datetime equal to today midnight local is NOT overdue', () => {
    // new Date(new Date().toDateString()) = today midnight LOCAL time (as a UTC moment).
    // Passing its ISO string back to isDueDateOverdue produces a date that is EXACTLY equal
    // to the comparison baseline. With `<` this is false (not overdue); with `<=` it would
    // be true (overdue). This test kills the EqualityOperator mutant.
    const todayMidnightLocal = new Date(new Date().toDateString());
    const isoEquivalent = todayMidnightLocal.toISOString(); // full datetime ISO string
    expect(isDueDateOverdue(isoEquivalent)).toBe(false);
  });

  // Timezone regression: YYYY-MM-DD strings must be treated as local midnight.
  it("returns false for today's local date as a YYYY-MM-DD string (not overdue)", () => {
    expect(isDueDateOverdue(todayLocalYMD())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isDueTodayOrOverdue
// ---------------------------------------------------------------------------

describe('isDueTodayOrOverdue', () => {
  it("returns true for today's local date as a YYYY-MM-DD string (boundary: today IS counted)", () => {
    // due_date is stored as a clean YYYY-MM-DD string, which parseDueDate maps to local
    // midnight — exactly the comparison baseline, so `<=` includes today.
    expect(isDueTodayOrOverdue(todayLocalYMD())).toBe(true);
  });

  it('returns true for a past date', () => {
    expect(isDueTodayOrOverdue(dueForDayOffset(-1))).toBe(true);
    expect(isDueTodayOrOverdue(dueForDayOffset(-10))).toBe(true);
  });

  it('returns false for tomorrow and the future', () => {
    expect(isDueTodayOrOverdue(dueForDayOffset(1))).toBe(false);
    expect(isDueTodayOrOverdue(dueForDayOffset(10))).toBe(false);
  });

  it('uses <= (not <): a datetime equal to today midnight local IS counted', () => {
    // Mirror of the isDueDateOverdue strict-less-than test, but inverted: today midnight
    // local fed back in is EXACTLY the baseline. With `<=` this is true; with `<` it would
    // be false. This test kills the EqualityOperator mutant on the boundary.
    const todayMidnightLocal = new Date(new Date().toDateString());
    expect(isDueTodayOrOverdue(todayMidnightLocal.toISOString())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isDueToday
// ---------------------------------------------------------------------------

describe('isDueToday', () => {
  it("returns true for today's local date as a YYYY-MM-DD string", () => {
    expect(isDueToday(todayLocalYMD())).toBe(true);
  });

  it('returns false for a past (overdue) date', () => {
    expect(isDueToday(dueForDayOffset(-1))).toBe(false);
    expect(isDueToday(dueForDayOffset(-10))).toBe(false);
  });

  it('returns false for tomorrow and the future', () => {
    expect(isDueToday(dueForDayOffset(1))).toBe(false);
    expect(isDueToday(dueForDayOffset(10))).toBe(false);
  });

  it('is exactly the band between overdue and upcoming (today midnight local)', () => {
    // today midnight local fed back in is EXACTLY the baseline: not overdue, but
    // due-today-or-overdue — so it lands in the due-today band and nowhere else.
    const todayMidnightLocal = new Date(new Date().toDateString());
    expect(isDueToday(todayMidnightLocal.toISOString())).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toISODate
// ---------------------------------------------------------------------------

describe('toISODate', () => {
  it('zero-pads month and day', () => {
    expect(toISODate(2025, 0, 5)).toBe('2025-01-05');
  });

  it('maps the 0-based month to its 1-based string', () => {
    expect(toISODate(2025, 11, 31)).toBe('2025-12-31');
  });

  it('zero-pads a short year', () => {
    expect(toISODate(7, 6, 4)).toBe('0007-07-04');
  });
});

// ---------------------------------------------------------------------------
// monthGridDays — the due-date picker's month grid
// ---------------------------------------------------------------------------

describe('monthGridDays', () => {
  it('always returns 42 cells (6 weeks)', () => {
    expect(monthGridDays(2025, 6)).toHaveLength(42);
    expect(monthGridDays(2025, 1)).toHaveLength(42); // February
  });

  it('starts on the Sunday on/before the 1st', () => {
    // July 2025: the 1st is a Tuesday, so the grid leads with Jun 29 (Sun), 30, then Jul 1.
    const grid = monthGridDays(2025, 6);
    expect(grid[0]).toEqual({ iso: '2025-06-29', day: 29, inMonth: false });
    expect(grid[1]).toEqual({ iso: '2025-06-30', day: 30, inMonth: false });
    expect(grid[2]).toEqual({ iso: '2025-07-01', day: 1, inMonth: true });
  });

  it('marks the month’s own days inMonth and spill days not', () => {
    const grid = monthGridDays(2025, 6);
    const july = grid.filter((c) => c.inMonth);
    expect(july).toHaveLength(31);
    expect(july[0]?.iso).toBe('2025-07-01');
    expect(july.at(-1)?.iso).toBe('2025-07-31');
    // Trailing spill comes from August.
    const trailing = grid.find((c) => !c.inMonth && c.iso > '2025-07-31');
    expect(trailing?.iso).toBe('2025-08-01');
  });

  it('handles a month that starts on Sunday with no leading spill', () => {
    // June 2025 starts on a Sunday.
    const grid = monthGridDays(2025, 5);
    expect(grid[0]).toEqual({ iso: '2025-06-01', day: 1, inMonth: true });
  });

  it('rolls the year over for January and December grids', () => {
    // January 2025 leads with late-December 2024 days.
    const jan = monthGridDays(2025, 0);
    expect(jan[0]?.iso.startsWith('2024-12')).toBe(true);
    // December 2025 trails into January 2026.
    const dec = monthGridDays(2025, 11);
    expect(dec.at(-1)?.iso.startsWith('2026-01')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// addDays — calendar-day arithmetic over `YYYY-MM-DD` strings. It lives here (not in
// lib/habits) because the row menu's due-date presets step off today too; `lib/habits/dates`
// re-exports it, so the habit call sites are unchanged.
// ---------------------------------------------------------------------------

describe('addDays', () => {
  it('crosses a month end', () => {
    expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    expect(addDays('2026-08-01', -1)).toBe('2026-07-31');
  });

  it('crosses a year end', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('crosses a leap day', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('is unaffected by a DST transition — these are calendar days, not instants', () => {
    // A naive instant + 24h across the US spring-forward lands back on the same local date.
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08');
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
  });

  it('needs a date-only input — a raw timestamptz is nonsense to it', () => {
    // Pinned here so a caller reading a `timestamptz` column knows to `.slice(0, 10)` first:
    // the split on "-" hands `Number('04T00:00:00+00:00')` → NaN, and `new Date(NaN)` throws
    // on `toISOString()`. The row menu's due-date presets normalise for exactly this reason.
    expect(() => addDays('2026-09-04T00:00:00+00:00', 1)).toThrow();
  });
});

describe('localISODate', () => {
  it("reads an instant's local calendar date, not its UTC one", () => {
    // Built from local fields, so the answer is the same in every zone the suite runs in.
    expect(localISODate(new Date(2026, 8, 30, 23, 59))).toBe('2026-09-30');
    expect(localISODate(new Date(2026, 9, 1, 0, 0))).toBe('2026-10-01');
  });

  it("is today's date for the live clock", () => {
    expect(todayISODate()).toBe(localISODate(new Date()));
  });
});

// ---------------------------------------------------------------------------
// Due times — a wall-clock time beside a date
// ---------------------------------------------------------------------------

/** A local instant, as the ISO string `setClockNow` takes — zone-independent fixtures. */
function localInstant(month0: number, day: number, hour: number, minute: number): string {
  return new Date(2026, month0, day, hour, minute).toISOString();
}

describe('normalizeDueTime', () => {
  it('trims the wire form PostgREST returns to HH:MM', () => {
    expect(normalizeDueTime('15:00:00')).toBe('15:00');
    expect(normalizeDueTime('09:30')).toBe('09:30');
  });

  it('reads an absent column (a view predating it) the same as no time', () => {
    expect(normalizeDueTime(null)).toBeNull();
    expect(normalizeDueTime(undefined)).toBeNull();
  });
});

describe('formatDueTime', () => {
  it('drops the minutes on the hour and keeps them otherwise (en-US)', () => {
    expect(formatDueTime('15:00', 'en-US')).toBe('3 PM');
    expect(formatDueTime('09:30', 'en-US')).toBe('9:30 AM');
    expect(formatDueTime('17:30:00', 'en-US')).toBe('5:30 PM');
  });

  it('names midnight and noon on the 12-hour clock', () => {
    expect(formatDueTime('00:00', 'en-US')).toBe('12 AM');
    expect(formatDueTime('12:00', 'en-US')).toBe('12 PM');
  });

  it('follows a 24-hour locale', () => {
    expect(formatDueTime('15:00', 'en-GB')).toBe('15');
    expect(formatDueTime('15:30', 'en-GB')).toBe('15:30');
    // Whether the hour is zero-padded is the ICU build's call; what matters is no AM/PM.
    expect(formatDueTime('09:30', 'en-GB')).toMatch(/^0?9:30$/);
  });
});

describe('formatDueLabel', () => {
  beforeEach(() => {
    setClockNow(localInstant(9, 3, 12, 0));
  });

  it('reads date + time when timed', () => {
    expect(formatDueLabel('2026-10-03', '15:00', 'en-US')).toBe('Today 3 PM');
    expect(formatDueLabel('2026-10-04', '09:30', 'en-US')).toBe('Tomorrow 9:30 AM');
    expect(formatDueLabel('2026-10-12', '18:00', 'en-US')).toBe('Oct 12 6 PM');
  });

  it('reads exactly as the date alone when untimed', () => {
    expect(formatDueLabel('2026-10-04', null, 'en-US')).toBe(formatDueDate('2026-10-04'));
  });
});

describe('dueMoment', () => {
  it('is the local instant of date + time', () => {
    expect(dueMoment('2026-10-03', '15:00')).toEqual(new Date(2026, 9, 3, 15, 0));
    expect(dueMoment('2026-10-03T00:00:00+00:00', '09:30:00')).toEqual(new Date(2026, 9, 3, 9, 30));
  });

  it("is the day's last millisecond when untimed — after every timed task that day", () => {
    expect(dueMoment('2026-10-03', null)).toEqual(new Date(2026, 9, 3, 23, 59, 59, 999));
    expect(dueMoment('2026-10-03', '23:59').getTime()).toBeLessThan(
      dueMoment('2026-10-03', null).getTime(),
    );
    expect(dueMoment('2026-10-03', null).getTime()).toBeLessThan(
      dueMoment('2026-10-04', '00:00').getTime(),
    );
  });

  it('puts a midnight time first in its day, distinct from untimed', () => {
    expect(dueMoment('2026-10-03', '00:00')).toEqual(new Date(2026, 9, 3, 0, 0));
  });
});

describe('isPastDue', () => {
  it('flips a timed task at its minute, not before', () => {
    expect(isPastDue('2026-10-03', '15:00', new Date(2026, 9, 3, 14, 59, 59))).toBe(false);
    expect(isPastDue('2026-10-03', '15:00', new Date(2026, 9, 3, 15, 0))).toBe(true);
  });

  it('is past due from a midnight time onward', () => {
    expect(isPastDue('2026-10-03', '00:00', new Date(2026, 9, 3, 0, 0))).toBe(true);
    expect(isPastDue('2026-10-03', '00:00', new Date(2026, 9, 2, 23, 59))).toBe(false);
  });

  it('keeps the day rule for an untimed task, matching isDueDateOverdue', () => {
    const now = new Date(2026, 9, 3, 23, 59);
    setClockNow(now.toISOString());
    for (const date of ['2026-10-02', '2026-10-03', '2026-10-04']) {
      expect(isPastDue(date, null, now)).toBe(isDueDateOverdue(date));
    }
    expect(isPastDue('2026-10-03', null, now)).toBe(false);
    expect(isPastDue('2026-10-02', null, now)).toBe(true);
  });

  it('treats any time on an earlier day as past due, and any on a later day as not', () => {
    const now = new Date(2026, 9, 3, 9, 0);
    expect(isPastDue('2026-10-02', '23:59', now)).toBe(true);
    expect(isPastDue('2026-10-04', '00:00', now)).toBe(false);
  });
});

describe('lateness', () => {
  const now = new Date(2026, 9, 3, 15, 30);

  it('is the real minute once hydrated', () => {
    expect(lateness(now, true)).toBe(now);
  });

  it("is the start of the day while hydrating, so a timed task today isn't late yet", () => {
    expect(lateness(now, false)).toEqual(new Date(2026, 9, 3));
    expect(isPastDue('2026-10-03', '15:00', lateness(now, false))).toBe(false);
    expect(isPastDue('2026-10-02', '23:00', lateness(now, false))).toBe(true);
  });
});
