/**
 * The pure recurrence engine — no React, no DB, no ambient `Date.now()`. All inputs (the
 * rule, the current due date, the occurrence index) are passed in, so the date arithmetic is
 * exhaustively unit-testable. Date parsing reuses `lib/date-utils`' local-midnight convention
 * (`parseDueDate`), so calendar-date math never drifts across a DST boundary.
 */
import { formatMonthDay, parseDueDate } from '@/lib/date-utils';

import type { MonthlyMode, RecurrenceRule, Weekday } from './types';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const WEEKDAY_ORDER: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/**
 * Unique weekdays in ascending Sun→Sat order. Filtering the fixed 0–6 order avoids
 * `Array#sort` (the repo bans the mutating form, and `toSorted` needs ES2023 > the ES2022
 * target — see `lib/tree`). Shared by the engine and the preset bridge.
 */
export function sortedWeekdays(byweekday: readonly Weekday[]): Weekday[] {
  const set = new Set(byweekday);
  return WEEKDAY_ORDER.filter((d) => set.has(d));
}
const SETPOS_LABELS: Record<number, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  5: 'fifth',
  [-1]: 'last',
};

// ---------------------------------------------------------------------------
// Date helpers (local-calendar arithmetic)
// ---------------------------------------------------------------------------

/** Number of days in a given local month (month0 0-11). */
function daysInMonth(year: number, month0: number): number {
  // Day 0 of the next month is the last day of this month.
  return new Date(year, month0 + 1, 0).getDate();
}

/** Format a local `Date` as a date-only `YYYY-MM-DD` string. */
function formatDate(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Format a local `Date` as a `YYYY-MM-DDTHH:mm:ss` string (no zone — engine-only hourly). */
function formatDateTime(date: Date): string {
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  return `${formatDate(date)}T${time}`;
}

/** A new local Date at midnight for the given Y/M/D, clamping the day to the month's length. */
function clampedDate(year: number, month0: number, day: number): Date {
  return new Date(year, month0, Math.min(day, daysInMonth(year, month0)));
}

/** The Nth (`setpos`) `weekday` of a month, or `null` when that occurrence doesn't exist. */
function nthWeekdayOfMonth(
  year: number,
  month0: number,
  setpos: number,
  weekday: Weekday,
): Date | null {
  if (setpos === -1) {
    // Walk back from the last day to the first matching weekday.
    const last = daysInMonth(year, month0);
    for (let day = last; day >= 1; day--) {
      if (new Date(year, month0, day).getDay() === weekday) return new Date(year, month0, day);
    }
    return null; // unreachable: every weekday occurs at least once a month
  }
  // Find the first matching weekday, then step forward in weeks to the Nth one.
  const firstDow = new Date(year, month0, 1).getDay();
  const offset = (weekday - firstDow + 7) % 7;
  const day = 1 + offset + (setpos - 1) * 7;
  return day <= daysInMonth(year, month0) ? new Date(year, month0, day) : null;
}

// ---------------------------------------------------------------------------
// Per-frequency advance
// ---------------------------------------------------------------------------

function nextWeekly(date: Date, interval: number, byweekday: Weekday[]): Date {
  const days = sortedWeekdays(byweekday);
  const dow = date.getDay();
  const sameWeek = days.find((d) => d > dow);
  if (sameWeek !== undefined) {
    return addDays(date, sameWeek - dow);
  }
  // The current week is exhausted: jump `interval` weeks forward to that week's first
  // selected day. (-dow lands on this week's Sunday; +interval*7 advances the week.)
  // Stryker disable next-line OptionalChaining: `days` is guaranteed non-empty (the rule's
  // byweekday is non-empty when present), so days[0] is always defined.
  return addDays(date, -dow + interval * 7 + (days[0] ?? 0));
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function nextMonthly(date: Date, interval: number, monthly: MonthlyMode): Date {
  const baseMonth = date.getFullYear() * 12 + date.getMonth();
  if (monthly.kind === 'day_of_month') {
    const target = baseMonth + interval;
    return clampedDate(Math.floor(target / 12), target % 12, date.getDate());
  }
  // Positional: step forward `interval` months at a time until a month actually has the
  // requested occurrence (e.g. a 5th Friday), so setpos 5 skips months that lack it.
  for (let target = baseMonth + interval; ; target += interval) {
    const found = nthWeekdayOfMonth(
      Math.floor(target / 12),
      target % 12,
      monthly.setpos,
      monthly.weekday,
    );
    if (found !== null) return found;
  }
}

/** Compute the raw next due `Date` for a rule, ignoring the end condition. */
function advance(rule: RecurrenceRule, date: Date): Date {
  switch (rule.freq) {
    case 'hourly': {
      const next = new Date(date);
      next.setHours(next.getHours() + rule.interval);
      return next;
    }
    case 'daily': {
      return addDays(date, rule.interval);
    }
    case 'weekly': {
      return nextWeekly(date, rule.interval, rule.byweekday ?? []);
    }
    case 'monthly': {
      return nextMonthly(date, rule.interval, rule.monthly ?? { kind: 'day_of_month' });
    }
    case 'yearly': {
      return clampedDate(date.getFullYear() + rule.interval, date.getMonth(), date.getDate());
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Given a rule, the current occurrence's due date (ISO), and its 1-based index in the series,
 * return the **next** due date (ISO), or `null` when the series has ended.
 *
 *  - `after N`: the Nth occurrence is the last, so once `occurrenceIndex >= count` there is no
 *    successor.
 *  - `on_date`: the computed date is returned unless its calendar day is strictly after
 *    `until` (boundary-inclusive).
 *  - `never`: always advances.
 *
 * Hourly results carry a time component; all coarser frequencies return a `YYYY-MM-DD` date.
 */
export function nextOccurrence(
  rule: RecurrenceRule,
  currentDue: string,
  occurrenceIndex: number,
): string | null {
  if (rule.end.type === 'after' && occurrenceIndex >= rule.end.count) return null;

  const next = advance(rule, parseDueDate(currentDue));

  if (rule.end.type === 'on_date') {
    const until = parseDueDate(rule.end.until);
    const nextDayStart = new Date(next.getFullYear(), next.getMonth(), next.getDate());
    if (nextDayStart > until) return null;
  }

  return rule.freq === 'hourly' ? formatDateTime(next) : formatDate(next);
}

// ---------------------------------------------------------------------------
// Human-readable summary
// ---------------------------------------------------------------------------

function listWeekdays(byweekday: Weekday[]): string {
  return sortedWeekdays(byweekday)
    .map((d) => WEEKDAY_LABELS[d])
    .join(', ');
}

function sameDays(byweekday: Weekday[] | undefined, target: Weekday[]): boolean {
  const days = sortedWeekdays(byweekday ?? []);
  return days.length === target.length && days.every((d, index) => d === target[index]);
}

function summarizeBase(rule: RecurrenceRule): string {
  const n = rule.interval;
  switch (rule.freq) {
    case 'hourly': {
      return n === 1 ? 'Hourly' : `Every ${String(n)} hours`;
    }
    case 'daily': {
      return n === 1 ? 'Daily' : `Every ${String(n)} days`;
    }
    case 'weekly': {
      if (n === 1 && sameDays(rule.byweekday, [1, 2, 3, 4, 5])) return 'Weekdays';
      if (n === 1 && sameDays(rule.byweekday, [0, 6])) return 'Weekends';
      const prefix = n === 1 ? 'Weekly' : `Every ${String(n)} weeks`;
      const days = listWeekdays(rule.byweekday ?? []);
      return days === '' ? prefix : `${prefix} on ${days}`;
    }
    case 'monthly': {
      const prefix = n === 1 ? 'Monthly' : `Every ${String(n)} months`;
      const monthly = rule.monthly ?? { kind: 'day_of_month' };
      if (monthly.kind === 'positional') {
        return `${prefix} on the ${SETPOS_LABELS[monthly.setpos] ?? ''} ${WEEKDAY_LABELS[monthly.weekday]}`;
      }
      return prefix;
    }
    case 'yearly': {
      return n === 1 ? 'Yearly' : `Every ${String(n)} years`;
    }
  }
}

/**
 * A human label for the row chip / trigger, e.g. `"Every 2 weeks on Mon, Wed"`,
 * `"Monthly on the last Fri"`, `"Daily until Aug 1"`, `"Weekly on Mon for 5 times"`.
 */
export function summarizeRule(rule: RecurrenceRule): string {
  const base = summarizeBase(rule);
  switch (rule.end.type) {
    case 'never': {
      return base;
    }
    case 'on_date': {
      return `${base} until ${formatMonthDay(rule.end.until)}`;
    }
    case 'after': {
      return `${base} for ${String(rule.end.count)} times`;
    }
  }
}
