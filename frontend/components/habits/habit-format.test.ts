import {
  beforeStartName,
  criterionKeyFrom,
  dayAccessibleName,
  formatActiveDays,
  formatAllowance,
  formatAllowanceSlot,
  formatDaysSlot,
  formatLongDate,
  formatShortDate,
  formatTarget,
  habitSummary,
  minutesToTime,
  timeToMinutes,
  weekdayName,
} from '@/components/habits/habit-format';
import type { HabitCriterion } from '@/lib/habits';
import type { Habit } from '@/lib/types';

const WAKE: HabitCriterion = {
  key: 'wake',
  label: 'Up by 6:15',
  kind: 'time',
  target: 375,
  comparator: 'lte',
};
const LIGHT: HabitCriterion = { key: 'light', label: 'Outside for light', kind: 'boolean' };

describe('date formatting', () => {
  it('reads a calendar date as itself, never shifted by the machine zone', () => {
    expect(formatLongDate('2026-07-23')).toBe('Thursday 23 July');
    expect(formatShortDate('2026-07-23')).toBe('Thu 23 Jul');
  });
});

describe('time conversion', () => {
  it.each([
    [0, '00:00'],
    [375, '06:15'],
    [364, '06:04'],
    [1439, '23:59'],
  ])('renders %i minutes after midnight as %s', (minutes, text) => {
    expect(minutesToTime(minutes)).toBe(text);
  });

  it('round-trips a typed time back to minutes', () => {
    expect(timeToMinutes('06:15')).toBe(375);
    expect(timeToMinutes('6:15')).toBe(375);
    expect(timeToMinutes('00:00')).toBe(0);
  });

  it('reads an unparseable or out-of-range time as nothing recorded', () => {
    expect(timeToMinutes('')).toBeUndefined();
    expect(timeToMinutes('six fifteen')).toBeUndefined();
    expect(timeToMinutes('25:00')).toBeUndefined();
    expect(timeToMinutes('06:75')).toBeUndefined();
  });

  it('renders a time criterion’s target as a clock and everything else as a number', () => {
    expect(formatTarget(WAKE)).toBe('06:15');
    expect(
      formatTarget({ key: 'g', label: 'Glasses', kind: 'count', target: 3, comparator: 'gte' }),
    ).toBe('3');
    expect(formatTarget(LIGHT)).toBe('');
  });
});

describe('dayAccessibleName', () => {
  it('opens with the date and the verdict, then one clause per criterion', () => {
    expect(
      dayAccessibleName('2026-07-23', 'partial', [WAKE, LIGHT], { wake: 364, light: false }, null),
    ).toBe('Thursday 23 July — partial. Up by 6:15: met (06:04). Outside for light: not met.');
  });

  it('says a criterion is not recorded rather than reporting it as a failure', () => {
    expect(dayAccessibleName('2026-07-23', 'missed', [WAKE, LIGHT], {}, null)).toBe(
      'Thursday 23 July — missed. Up by 6:15: not recorded. Outside for light: not recorded.',
    );
  });

  it('reads an unlogged day as not logged, with no criteria to report', () => {
    expect(dayAccessibleName('2026-07-23', 'unknown', [WAKE, LIGHT], {}, null)).toBe(
      'Thursday 23 July — not logged',
    );
  });

  it('carries a skipped day’s reason, which is what makes requiring one worth anything', () => {
    expect(dayAccessibleName('2026-07-14', 'skipped', [WAKE, LIGHT], {}, 'flu, off all week')).toBe(
      'Tuesday 14 July — skipped: flu, off all week',
    );
  });

  it('reads a reasonless skip without a dangling colon', () => {
    expect(dayAccessibleName('2026-07-14', 'skipped', [], {}, null)).toBe(
      'Tuesday 14 July — skipped',
    );
  });
});

describe('beforeStartName', () => {
  it('says the habit had not started, and that the day can still be filled in', () => {
    // A pre-start cell is reachable but carries no verdict, so its name has to offer the action
    // instead of reporting an outcome — it is the only clue that the square does anything.
    expect(beforeStartName('2026-06-20')).toBe(
      'Saturday 20 June — before this habit started. Log it to start the habit here',
    );
  });
});

describe('cadence wording', () => {
  it.each([
    [[1, 2, 3, 4, 5, 6, 7], 'every day'],
    [[1, 2, 3, 4, 5], 'weekdays'],
    [[6, 7], 'weekends'],
    [[1, 3, 5], 'Mon, Wed, Fri'],
  ])('summarises %j as "%s"', (days, text) => {
    expect(formatActiveDays(days)).toBe(text);
  });

  it('reads the days back in calendar order however they were chosen', () => {
    expect(formatActiveDays([5, 1, 3])).toBe('Mon, Wed, Fri');
  });

  it.each([
    [0, 'no misses'],
    [1, '1 miss / rolling week'],
    [2, '2 misses / rolling week'],
  ])('summarises an allowance of %i as "%s"', (allowance, text) => {
    expect(formatAllowance(allowance)).toBe(text);
  });

  it('reads the sentence slots as sentence fragments, not summaries', () => {
    expect(formatDaysSlot([1, 2, 3, 4, 5, 6, 7])).toBe('day');
    expect(formatDaysSlot([1, 2, 3, 4, 5])).toBe('weekday');
    expect(formatDaysSlot([1, 3])).toBe('Mon, Wed');
    expect(formatAllowanceSlot(0)).toBe('no misses a week');
    expect(formatAllowanceSlot(1)).toBe('1 miss a week');
    expect(formatAllowanceSlot(3)).toBe('3 misses a week');
  });

  it('names a weekday in full for a toggle label', () => {
    expect(weekdayName(1)).toBe('Monday');
    expect(weekdayName(7)).toBe('Sunday');
  });

  it('joins the two halves for the line under a habit’s name', () => {
    const habit = { active_days: [1, 2, 3, 4, 5, 6, 7], allowance: 1 } as Habit;
    expect(habitSummary(habit)).toBe('every day · 1 miss / rolling week');
  });
});

describe('criterionKeyFrom', () => {
  it('slugifies a label into a stable, storable key', () => {
    expect(criterionKeyFrom('Up by 6:15', [])).toBe('up_by_6_15');
    expect(criterionKeyFrom('Outside for light', [])).toBe('outside_for_light');
  });

  it('strips leading non-letters and trailing separators', () => {
    expect(criterionKeyFrom('  3 glasses of water ', [])).toBe('glasses_of_water');
  });

  it('de-duplicates against the keys already taken', () => {
    expect(criterionKeyFrom('Water', ['water'])).toBe('water_2');
    expect(criterionKeyFrom('Water', ['water', 'water_2'])).toBe('water_3');
  });

  it('falls back to a usable key when the label slugifies to nothing', () => {
    expect(criterionKeyFrom('!!!', [])).toBe('criterion');
  });

  it('never exceeds the 32 characters the route accepts', () => {
    const key = criterionKeyFrom('a'.repeat(80), []);
    expect(key).toHaveLength(32);
    expect(key).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
  });
});
