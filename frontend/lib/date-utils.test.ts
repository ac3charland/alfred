import { MONTHS, formatDueDate, isDueDateOverdue } from './date-utils';

// ---------------------------------------------------------------------------
// Timezone-safe helpers (same approach as task-row.test.tsx)
// ---------------------------------------------------------------------------

/**
 * Returns the ISO YYYY-MM-DD string that, when passed to `new Date('YYYY-MM-DD')`,
 * produces a Date whose LOCAL date fields (getFullYear/getMonth/getDate) match the
 * intended (year, month0, day). Accounts for the UTC-midnight parsing rule so tests
 * are correct in any timezone.
 *
 * Uses `Math.ceil` of the timezone offset in fractional days. For negative UTC offsets
 * (e.g. UTC-7 = 420 min), ceil(420/1440) = 1, so the helper returns (day+1)'s UTC
 * midnight, which equals (day)'s local time — correct for the month+day label tests.
 * Do NOT use this for Yesterday/Tomorrow/Today tests; use dueForDayOffset instead.
 */
function localDueDate(year: number, month0: number, day: number): string {
  const tzOffsetDays = Math.ceil(new Date().getTimezoneOffset() / (24 * 60));
  return new Date(year, month0, day + tzOffsetDays).toISOString().slice(0, 10);
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
});
