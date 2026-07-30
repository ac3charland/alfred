import {
  STAGE_LABEL,
  archivedSpan,
  bankedAccessibleName,
  beforeStartName,
  criterionKeyFrom,
  dayAccessibleName,
  deleteConfirmLine,
  formatActiveDays,
  formatAllowance,
  formatAllowanceSlot,
  formatBanked,
  formatDayMonth,
  formatDaysSlot,
  formatHitRate,
  formatLongDate,
  formatShortDate,
  formatStreakLength,
  formatTarget,
  habitSummary,
  lockedReason,
  lockedSlotName,
  minutesToTime,
  timeToMinutes,
  weekdayName,
} from '@/components/habits/habit-format';
import { ESTABLISHED_DAYS, formationStage } from '@/lib/habits';
import type { FormationStage, HabitCriterion } from '@/lib/habits';
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

describe('STAGE_LABEL', () => {
  it('names every rung of the ladder, so a fifth can never ship unlabelled', () => {
    const stages: FormationStage[] = [
      'fully_deliberate',
      'gaining_momentum',
      'nearing_automaticity',
      'possibly_established',
    ];

    // The Record's type makes a missing rung a type error; the count makes a stray key a test
    // failure. Between them a fifth rung can't ship unlabelled.
    expect(Object.keys(STAGE_LABEL)).toHaveLength(stages.length);
    expect(stages.map((stage) => STAGE_LABEL[stage])).toStrictEqual([
      'Fully Deliberate',
      'Gaining Momentum',
      'Nearing Automaticity',
      'Possibly Established',
    ]);
  });

  it('hedges the top rung rather than declaring the habit established', () => {
    expect(STAGE_LABEL[formationStage(ESTABLISHED_DAYS)]).toBe('Possibly Established');
  });
});

describe('formatHitRate', () => {
  it('rounds to a whole percent', () => {
    expect(formatHitRate(0.9375)).toBe('94%');
    expect(formatHitRate(1)).toBe('100%');
    expect(formatHitRate(0)).toBe('0%');
  });

  it('renders nothing-rated-yet as an em dash, never as zero', () => {
    expect(formatHitRate(null)).toBe('—');
  });
});

describe('formatStreakLength', () => {
  it('shows one decimal, dropping a trailing zero', () => {
    expect(formatStreakLength(14)).toBe('14');
    expect(formatStreakLength(5.5)).toBe('5.5');
    expect(formatStreakLength(5.04)).toBe('5');
    expect(formatStreakLength(0)).toBe('0');
  });

  it('renders no-ended-runs as an em dash — "no average yet" is not "an average of zero"', () => {
    expect(formatStreakLength(null)).toBe('—');
  });
});

describe('formatBanked', () => {
  it('counts toward the marker while it is still pending', () => {
    expect(formatBanked(47)).toBe('47 of ~66 banked days');
    expect(formatBanked(0)).toBe('0 of ~66 banked days');
    expect(formatBanked(ESTABLISHED_DAYS - 1)).toBe('65 of ~66 banked days');
  });

  it('switches to the past form the day the marker is reached, not the day after', () => {
    expect(formatBanked(ESTABLISHED_DAYS)).toBe('66 banked days · past ~66');
    expect(formatBanked(ESTABLISHED_DAYS + 1)).toBe('67 banked days · past ~66');
  });
});

describe('bankedAccessibleName', () => {
  it('spells the hedge out, since a tilde reads as noise aloud', () => {
    expect(bankedAccessibleName(47)).toBe('47 of about 66 banked days');
    expect(bankedAccessibleName(82)).toBe('82 banked days, past about 66');
    expect(bankedAccessibleName(47)).not.toContain('~');
  });
});

describe('formatDayMonth', () => {
  it('drops the weekday, for a sentence that already has a subject', () => {
    expect(formatDayMonth('2026-06-12')).toBe('12 June');
  });
});

describe('lockedReason', () => {
  it('names the count and what changing the slot would rewrite', () => {
    expect(lockedReason('slack', { count: 63, isExact: true })).toBe(
      '63 days are already logged. Changing your slack would rewrite what those days counted for, so the streak you earned stays the streak you see.',
    );
  });

  it('names the days slot in the owner’s terms rather than the column’s', () => {
    expect(lockedReason('days', { count: 63, isExact: true })).toContain(
      'Changing which days count',
    );
  });

  // A habit older than the seeded window is a floor, and the sentence has to say so.
  it('hedges a count the window cannot vouch for', () => {
    expect(lockedReason('slack', { count: 118, isExact: false })).toMatch(
      /^at least 118 days are already logged\./,
    );
  });

  it('agrees the verb with a single logged day', () => {
    expect(lockedReason('slack', { count: 1, isExact: true })).toMatch(
      /^1 day is already logged\./,
    );
  });
});

describe('lockedSlotName', () => {
  it('puts the state before the value, so it is announced first', () => {
    expect(lockedSlotName('Days:', 'day')).toBe('Locked: Days: day');
  });
});

describe('archivedSpan', () => {
  it('reads the span a habit ran for, with the year said once', () => {
    const habit = {
      started_on: '2026-02-03',
      archived_at: '2026-05-18T09:00:00Z',
    } as Habit;
    expect(archivedSpan(habit)).toBe('ran 3 Feb – 18 May 2026');
  });

  it('says both years for a span that crosses New Year', () => {
    const habit = {
      started_on: '2025-11-30',
      archived_at: '2026-02-02T09:00:00Z',
    } as Habit;
    expect(archivedSpan(habit)).toBe('ran 30 Nov 2025 – 2 Feb 2026');
  });

  it('falls back to the start alone for a habit that is not archived', () => {
    const habit = { started_on: '2026-02-03', archived_at: null } as Habit;
    expect(archivedSpan(habit)).toBe('started 3 Feb 2026');
  });
});

describe('deleteConfirmLine', () => {
  const habit = { started_on: '2026-06-12' } as Habit;

  it('names the exact cost when the whole history is in hand', () => {
    expect(deleteConfirmLine(habit, { count: 63, isExact: true })).toBe(
      'This destroys the habit and every day logged against it — 63 days, since 12 June. It cannot be undone.',
    );
  });

  it('never overstates certainty for a habit older than the window', () => {
    const older = { started_on: '2026-02-03' } as Habit;
    expect(deleteConfirmLine(older, { count: 118, isExact: false })).toBe(
      'This destroys the habit and every day logged against it — at least 118 days, since 3 February. It cannot be undone.',
    );
  });

  it('says plainly that nothing is at stake when nothing is logged', () => {
    expect(deleteConfirmLine(habit, { count: 0, isExact: true })).toBe(
      'This destroys this habit. Nothing has been logged against it yet.',
    );
  });

  // A zero the window can't vouch for is not a "nothing logged" — there may be older days.
  it('does not claim an empty habit when the count is only a floor', () => {
    expect(deleteConfirmLine(habit, { count: 0, isExact: false })).toContain('at least 0 days');
  });
});
