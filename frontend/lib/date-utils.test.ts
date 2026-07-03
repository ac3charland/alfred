import {
  MONTHS,
  formatDueDate,
  isDueDateOverdue,
  isDueToday,
  isDueTodayOrOverdue,
  monthGridDays,
  toISODate,
} from './date-utils';

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
