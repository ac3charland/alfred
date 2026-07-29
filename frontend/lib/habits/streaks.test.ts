import { addDays } from '@/lib/habits/dates';
import {
  buildHabitCalendar,
  computeHabitStats,
  formationStage,
  isApplicableDay,
} from '@/lib/habits/streaks';
import type { HabitDay } from '@/lib/habits/types';
import type { Habit, HabitDayStatus, HabitEntry } from '@/lib/types';

/**
 * Fixtures are written as a code string starting at a date, one character per calendar day:
 * `m` met · `p` partial · `x` missed · `s` skipped · `.` never logged. That keeps a five-week
 * grid readable in the test, which matters because this module's edge cases live in the
 * *shape* of a run, not in any single day.
 */
const CODES: Record<string, HabitDayStatus | undefined> = {
  m: 'met',
  p: 'partial',
  x: 'missed',
  s: 'skipped',
  '.': undefined,
};

// 2026-06-29 and 2026-07-27 are both Mondays; every fixture below is anchored to one of them.
function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-1',
    name: 'Morning routine',
    notes: null,
    criteria: [{ key: 'light', label: 'Outside for light', kind: 'boolean' }],
    active_days: [1, 2, 3, 4, 5, 6, 7],
    allowance: 1,
    started_on: '2026-07-27',
    archived_at: null,
    sort_order: null,
    created_at: '2026-07-27T00:00:00Z',
    ...overrides,
  };
}

function log(from: string, codes: string, habitId = 'habit-1'): HabitEntry[] {
  const entries: HabitEntry[] = [];
  let offset = -1;
  for (const code of codes) {
    offset += 1;
    const status = CODES[code];
    if (status === undefined) continue;
    const date = addDays(from, offset);
    entries.push({
      id: `entry-${date}`,
      habit_id: habitId,
      entry_date: date,
      status,
      results: null,
      note: status === 'skipped' ? 'flu' : null,
      created_at: `${date}T08:00:00Z`,
      updated_at: `${date}T08:00:00Z`,
    });
  }
  return entries;
}

/** The calendar over exactly the fixture's span, which is what the link assertions read. */
function calendarFor(habit: Habit, entries: HabitEntry[], from: string, today: string): HabitDay[] {
  return buildHabitCalendar(habit, entries, { from, to: today, today });
}

function linksOf(days: HabitDay[]): HabitDay['link'][] {
  return days.map((day) => day.link);
}

describe('isApplicableDay', () => {
  const habit = makeHabit({ started_on: '2026-07-27', active_days: [1, 2, 3, 4, 5] });

  it('excludes days before started_on', () => {
    expect(isApplicableDay(habit, '2026-07-26')).toBe(false);
    expect(isApplicableDay(habit, '2026-07-27')).toBe(true);
  });

  it('excludes weekdays outside active_days', () => {
    expect(isApplicableDay(habit, '2026-08-01')).toBe(false);
    expect(isApplicableDay(habit, '2026-08-02')).toBe(false);
    expect(isApplicableDay(habit, '2026-07-31')).toBe(true);
  });

  it('excludes the archive date and everything after it', () => {
    const archived = makeHabit({ archived_at: '2026-07-29T12:00:00Z' });
    expect(isApplicableDay(archived, '2026-07-28')).toBe(true);
    expect(isApplicableDay(archived, '2026-07-29')).toBe(false);
    expect(isApplicableDay(archived, '2026-07-30')).toBe(false);
  });
});

describe("the epic's worked example — one week, allowance 1, a partial Wednesday", () => {
  const habit = makeHabit({ allowance: 1, started_on: '2026-07-27' });
  const entries = log('2026-07-27', 'mmpmmmm');
  const today = '2026-08-02';

  it('greys the links either side of the forgiven day and leaves the rest lit', () => {
    expect(linksOf(calendarFor(habit, entries, '2026-07-27', today))).toEqual([
      'streak', // Mon → Tue
      'bridge', // Tue → the forgiven Wednesday
      'bridge', // the forgiven Wednesday → Thu
      'streak',
      'streak',
      'streak',
      'none', // today: tomorrow hasn't happened
    ]);
  });

  it('counts six met days, not the seven elapsed ones, and spends the week’s allowance', () => {
    const stats = computeHabitStats(habit, entries, today);
    expect(stats.currentStreak).toBe(6);
    expect(stats.allowanceRemaining).toBe(0);
  });
});

describe("the epic's five-week grid — a forgiven partial, a real break, and a free skip", () => {
  const habit = makeHabit({ allowance: 1, started_on: '2026-07-01' });
  const today = '2026-07-30';
  const entries = log(
    '2026-07-01',
    // Wed–Sun | full week, Wed partial | Thu missed then Fri unlogged | Wed skipped | Mon–today
    'mmmmm' + 'mmpmmmm' + 'mmmx.mm' + 'mmsmmmm' + 'mmmm',
  );
  const calendar = calendarFor(habit, entries, '2026-07-01', today);
  const linkOn = (date: string) => calendar.find((day) => day.date === date)?.link;

  it('bridges into and out of the forgiven partial', () => {
    expect(linkOn('2026-07-07')).toBe('bridge');
    expect(linkOn('2026-07-08')).toBe('bridge');
  });

  it('stops the chain dead where two spent days share one rolling window', () => {
    // The missed Thursday is forgiven on its own — grey link in…
    expect(linkOn('2026-07-15')).toBe('bridge');
    // …but the unlogged Friday is the second spent day in the window, so nothing crosses it.
    expect(linkOn('2026-07-16')).toBe('none');
    expect(linkOn('2026-07-17')).toBe('none');
    // Saturday begins the run that is still going.
    expect(linkOn('2026-07-18')).toBe('streak');
  });

  it('keeps a skipped day’s links fully lit — a skip costs nothing', () => {
    expect(linkOn('2026-07-21')).toBe('streak');
    expect(linkOn('2026-07-22')).toBe('streak');
  });

  it('draws no link out of today, whose tomorrow has not happened', () => {
    expect(linkOn(today)).toBe('none');
  });

  it('tints only the live run', () => {
    const inStreak = calendar.filter((day) => day.inStreak).map((day) => day.date);
    expect(inStreak[0]).toBe('2026-07-18');
    expect(inStreak.at(-1)).toBe(today);
    expect(inStreak).not.toContain('2026-07-17');
  });

  it('reports the scalars the grid beside it shows', () => {
    const stats = computeHabitStats(habit, entries, today);
    expect(stats).toMatchObject({
      currentStreak: 12,
      longestStreak: 14,
      averageStreak: 14,
      allowanceRemaining: 1,
      metDaysTotal: 26,
      stage: 'gaining_momentum',
      counts: { met: 26, partial: 1, missed: 1, skipped: 1, unknown: 1 },
    });
    expect(stats.hitRate).toBeCloseTo(26 / 28);
  });
});

describe('the today exemption', () => {
  const habit = makeHabit({ allowance: 0, started_on: '2026-07-27' });

  it('does not zero the streak while today is applicable and unlogged', () => {
    const stats = computeHabitStats(habit, log('2026-07-27', 'mmm'), '2026-07-30');
    expect(stats.currentStreak).toBe(3);
  });

  it('does not charge an unlogged today against the allowance either', () => {
    const stats = computeHabitStats(
      makeHabit({ allowance: 1, started_on: '2026-07-27' }),
      log('2026-07-27', 'mmm'),
      '2026-07-30',
    );
    expect(stats.allowanceRemaining).toBe(1);
  });

  it('DOES count a miss that was actually logged today', () => {
    const stats = computeHabitStats(habit, log('2026-07-27', 'mmmx'), '2026-07-30');
    expect(stats.currentStreak).toBe(0);
  });
});

describe('a skipped day versus a forgiven one — the pair that stops the two being conflated', () => {
  const habit = makeHabit({ allowance: 1, started_on: '2026-07-27' });
  const today = '2026-07-29';

  it('steps over a skip with both links lit and the allowance untouched', () => {
    const entries = log('2026-07-27', 'msm');
    expect(linksOf(calendarFor(habit, entries, '2026-07-27', today))).toEqual([
      'streak',
      'streak',
      'none',
    ]);
    const stats = computeHabitStats(habit, entries, today);
    expect(stats.allowanceRemaining).toBe(1);
    expect(stats.currentStreak).toBe(2);
  });

  it('bridges over a partial and decrements the allowance', () => {
    const entries = log('2026-07-27', 'mpm');
    expect(linksOf(calendarFor(habit, entries, '2026-07-27', today))).toEqual([
      'bridge',
      'bridge',
      'none',
    ]);
    const stats = computeHabitStats(habit, entries, today);
    expect(stats.allowanceRemaining).toBe(0);
    expect(stats.currentStreak).toBe(2);
  });
});

describe('the rolling window boundary', () => {
  const today = '2026-08-02';

  it('survives two spent days when the allowance equals them', () => {
    const habit = makeHabit({ allowance: 2, started_on: '2026-07-27' });
    const entries = log('2026-07-27', 'mxxmmmm');
    expect(computeHabitStats(habit, entries, today).currentStreak).toBe(5);
  });

  it('breaks when those same two days exceed it', () => {
    const habit = makeHabit({ allowance: 1, started_on: '2026-07-27' });
    const entries = log('2026-07-27', 'mxxmmmm');
    const stats = computeHabitStats(habit, entries, today);
    // The second miss breaks the chain, so the live run is only what follows it.
    expect(stats.currentStreak).toBe(4);
    expect(linksOf(calendarFor(habit, entries, '2026-07-27', today))).toEqual([
      'bridge',
      'none', // the first miss is forgiven, but nothing crosses into the second
      'none',
      'streak',
      'streak',
      'streak',
      'none',
    ]);
  });

  it('forgives a second miss once the first has rolled out of the window', () => {
    const habit = makeHabit({ allowance: 1, started_on: '2026-07-27' });
    // Two misses eight days apart never share a rolling week.
    const entries = log('2026-07-27', 'xmmmmmmmx');
    expect(computeHabitStats(habit, entries, '2026-08-04').currentStreak).toBe(7);
  });
});

describe('non-applicable days', () => {
  const habit = makeHabit({ allowance: 0, active_days: [1, 2, 3, 4, 5], started_on: '2026-07-27' });

  it('never scores a weekend the habit does not run on', () => {
    const calendar = calendarFor(habit, log('2026-07-27', 'mmmmm'), '2026-07-27', '2026-08-03');
    const weekend = calendar.filter((day) => ['2026-08-01', '2026-08-02'].includes(day.date));
    expect(weekend.map((day) => day.status)).toEqual(['not_applicable', 'not_applicable']);
  });

  it('spends no allowance for the untracked days, so the chain survives them', () => {
    const forgiving = makeHabit({
      allowance: 1,
      active_days: [1, 2, 3, 4, 5],
      started_on: '2026-07-27',
    });
    const stats = computeHabitStats(forgiving, log('2026-07-27', 'mmmmm'), '2026-08-03');
    expect(stats.currentStreak).toBe(5);
    expect(stats.allowanceRemaining).toBe(1);
    // The weekend is in no denominator at all; the single unknown is today, still unlogged.
    expect(stats.counts).toEqual({ met: 5, partial: 0, missed: 0, skipped: 0, unknown: 1 });
  });

  it('renders a day before the habit started, and a future day, as untracked', () => {
    const calendar = buildHabitCalendar(makeHabit(), log('2026-07-27', 'm'), {
      from: '2026-07-25',
      to: '2026-07-29',
      today: '2026-07-27',
    });
    expect(calendar.map((day) => day.status)).toEqual([
      'not_applicable', // before started_on
      'not_applicable',
      'met',
      'not_applicable', // tomorrow
      'not_applicable',
    ]);
  });

  it('marks exactly one day as today', () => {
    const calendar = calendarFor(makeHabit(), log('2026-07-27', 'mm'), '2026-07-27', '2026-07-28');
    expect(calendar.filter((day) => day.isToday).map((day) => day.date)).toEqual(['2026-07-28']);
  });
});

describe('the scalars', () => {
  const habit = makeHabit({ allowance: 0, started_on: '2026-07-27' });

  it('leaves the hit rate null until something has been rated', () => {
    expect(computeHabitStats(habit, [], '2026-07-27').hitRate).toBeNull();
  });

  it('excludes unknown and skipped days from both sides of the hit rate', () => {
    // met, skipped, unlogged, missed → 1 met out of 2 rated days.
    const stats = computeHabitStats(habit, log('2026-07-27', 'ms.x'), '2026-07-31');
    expect(stats.hitRate).toBeCloseTo(0.5);
    expect(stats.counts).toEqual({ met: 1, partial: 0, missed: 1, skipped: 1, unknown: 2 });
  });

  it('leaves the average streak null while the only run is still in progress', () => {
    const stats = computeHabitStats(habit, log('2026-07-27', 'mmm'), '2026-07-29');
    expect(stats.averageStreak).toBeNull();
    expect(stats.currentStreak).toBe(3);
  });

  it('averages the ENDED runs only, so a growing run does not drag it down', () => {
    // A run of 4, broken by a miss, then a run of 1 still going.
    const stats = computeHabitStats(habit, log('2026-07-27', 'mmmmxm'), '2026-08-01');
    expect(stats.averageStreak).toBe(4);
    expect(stats.longestStreak).toBe(4);
    expect(stats.currentStreak).toBe(1);
  });

  it('counts the streak in met days, not elapsed days', () => {
    const forgiving = makeHabit({ allowance: 1, started_on: '2026-07-27' });
    const stats = computeHabitStats(forgiving, log('2026-07-27', 'mmmmpmmmmm'), '2026-08-05');
    // Ten elapsed days, one of them forgiven: the run is unbroken but only nine were earned.
    expect(stats.currentStreak).toBe(9);
  });
});

describe('the optional stats window', () => {
  // Two full weeks from a Monday: a solid first week, a ragged second one.
  const habit = makeHabit({ allowance: 0, started_on: '2026-07-27' });
  const entries = log('2026-07-27', 'mmmmmmm' + 'mxp.mms');
  const TODAY = '2026-08-09';

  it('scopes the counts and the hit rate to the window', () => {
    const firstWeek = computeHabitStats(habit, entries, TODAY, {
      from: '2026-07-27',
      to: '2026-08-02',
    });
    expect(firstWeek.counts).toEqual({ met: 7, partial: 0, missed: 0, skipped: 0, unknown: 0 });
    expect(firstWeek.hitRate).toBe(1);

    const secondWeek = computeHabitStats(habit, entries, TODAY, {
      from: '2026-08-03',
      to: '2026-08-09',
    });
    expect(secondWeek.counts).toEqual({ met: 3, partial: 1, missed: 1, skipped: 1, unknown: 1 });
    // 3 met of 5 rated; the skipped and unlogged days sit on neither side.
    expect(secondWeek.hitRate).toBeCloseTo(0.6);
  });

  it('leaves every all-history scalar identical whatever the window', () => {
    const wide = computeHabitStats(habit, entries, TODAY, { from: '2026-07-27', to: TODAY });
    const narrow = computeHabitStats(habit, entries, TODAY, {
      from: '2026-08-08',
      to: '2026-08-09',
    });

    for (const stats of [wide, narrow]) {
      expect(stats.currentStreak).toBe(2);
      expect(stats.longestStreak).toBe(8);
      expect(stats.metDaysTotal).toBe(10);
      expect(stats.averageStreak).toBe(8);
      expect(stats.allowanceRemaining).toBe(0);
      expect(stats.stage).toBe('fully_deliberate');
    }
  });

  it('adds no phantom unknown days outside [started_on, today]', () => {
    const stats = computeHabitStats(habit, entries, TODAY, {
      from: '2026-01-01',
      to: '2026-12-31',
    });
    // The window is a whole year; only the fourteen tracked days are counted.
    const total = Object.values(stats.counts).reduce((sum, count) => sum + count, 0);
    expect(total).toBe(14);
    expect(stats.counts.unknown).toBe(1);
  });

  it('omitting the window counts every applicable day', () => {
    const windowless = computeHabitStats(habit, entries, TODAY);
    const everything = computeHabitStats(habit, entries, TODAY, {
      from: '2026-07-27',
      to: TODAY,
    });
    expect(windowless).toStrictEqual(everything);
  });
});

describe('formationStage', () => {
  it.each([
    [0, 'fully_deliberate'],
    [13, 'fully_deliberate'],
    [14, 'gaining_momentum'],
    [41, 'gaining_momentum'],
    [42, 'nearing_automaticity'],
    [65, 'nearing_automaticity'],
    [66, 'possibly_established'],
    [400, 'possibly_established'],
  ])('puts %i met days at %s', (metDays, stage) => {
    expect(formationStage(metDays)).toBe(stage);
  });
});

describe('entries belonging to another habit', () => {
  it('are ignored rather than scored against this one', () => {
    const habit = makeHabit({ allowance: 0, started_on: '2026-07-27' });
    const foreign = log('2026-07-27', 'xxx', 'habit-2');
    const stats = computeHabitStats(habit, [...log('2026-07-27', 'mmm'), ...foreign], '2026-07-29');
    expect(stats.currentStreak).toBe(3);
  });
});
