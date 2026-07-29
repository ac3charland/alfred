import { statsWithBaseline } from '@/lib/habits/baseline';
import type { HabitStats } from '@/lib/habits/types';

/**
 * The splice is where every edge case of the rail lives, so it is pinned rule by rule rather
 * than through a render. Each case names the walk that KNOWS more and asserts the figure the
 * rail lands on.
 */

/** A stats object with everything at rest, overridden per case. */
function stats(overrides: Partial<HabitStats> = {}): HabitStats {
  return {
    currentStreak: 0,
    longestStreak: 0,
    averageStreak: null,
    allowanceRemaining: 1,
    hitRate: null,
    metDaysTotal: 0,
    stage: 'fully_deliberate',
    counts: { met: 0, partial: 0, missed: 0, skipped: 0, unknown: 0 },
    ...overrides,
  };
}

/** Counts differing only in met days — the difference the banked-day splice reads. */
function counts(met: number): HabitStats['counts'] {
  return { met, partial: 0, missed: 0, skipped: 0, unknown: 0 };
}

/** The reference habit: 190 days old, 33 met days unbroken, 47 banked, window holds 30 of them. */
const BASELINE = stats({
  currentStreak: 33,
  longestStreak: 33,
  averageStreak: 14,
  metDaysTotal: 47,
  stage: 'nearing_automaticity',
  counts: counts(47),
});

const AT_SEED = stats({
  currentStreak: 33,
  longestStreak: 33,
  averageStreak: 9,
  metDaysTotal: 30,
  stage: 'gaining_momentum',
  hitRate: 0.9375,
  counts: counts(30),
});

describe('statsWithBaseline', () => {
  it('returns the live walk verbatim when there is no baseline', () => {
    // A habit created this session has no history outside the window — the walk IS the truth.
    const live = stats({ currentStreak: 1, longestStreak: 1, metDaysTotal: 1, counts: counts(1) });

    expect(statsWithBaseline(undefined, live, live)).toStrictEqual(live);
  });

  it('shows the server’s all-history figures exactly at rest', () => {
    const spliced = statsWithBaseline(BASELINE, AT_SEED, AT_SEED);

    expect(spliced.currentStreak).toBe(33);
    expect(spliced.longestStreak).toBe(33);
    expect(spliced.averageStreak).toBe(14);
    expect(spliced.metDaysTotal).toBe(47);
    expect(spliced.stage).toBe('nearing_automaticity');
  });

  it('moves the current streak and the banked days by one when today is logged met', () => {
    const live = stats({
      ...AT_SEED,
      currentStreak: 34,
      longestStreak: 34,
      metDaysTotal: 31,
      counts: counts(31),
    });

    const spliced = statsWithBaseline(BASELINE, AT_SEED, live);

    expect(spliced.currentStreak).toBe(34);
    expect(spliced.metDaysTotal).toBe(48);
  });

  it('promotes the stage when the banked day crosses a rung', () => {
    const baseline = stats({ metDaysTotal: 13, stage: 'fully_deliberate', counts: counts(13) });
    const atSeed = stats({ metDaysTotal: 13, counts: counts(13) });
    const live = stats({ metDaysTotal: 14, counts: counts(14) });

    expect(statsWithBaseline(baseline, atSeed, live).stage).toBe('gaining_momentum');
  });

  it('drops both figures when a met day is corrected away, and floors them at zero', () => {
    // The chain broke mid-window: max(1, 33 + (1 − 33)) = 1, and one banked day is given back.
    const live = stats({ ...AT_SEED, currentStreak: 1, metDaysTotal: 29, counts: counts(29) });

    const spliced = statsWithBaseline(BASELINE, AT_SEED, live);

    expect(spliced.currentStreak).toBe(1);
    expect(spliced.metDaysTotal).toBe(46);
  });

  it('never reports a negative streak or a negative banked-day count', () => {
    const baseline = stats({ currentStreak: 1, metDaysTotal: 1, counts: counts(1) });
    const atSeed = stats({ currentStreak: 4, metDaysTotal: 4, counts: counts(4) });
    const live = stats({ currentStreak: 0, metDaysTotal: 0, counts: counts(0) });

    const spliced = statsWithBaseline(baseline, atSeed, live);

    expect(spliced.currentStreak).toBe(0);
    expect(spliced.metDaysTotal).toBe(0);
  });

  it('takes the live walk’s streak when it knows more — the evening-behind-UTC case', () => {
    // The server's UTC today ran ahead of the owner's, so its walk charged an unlogged day the
    // local walk correctly exempts. The larger of the two is the one that saw the run alive.
    const baseline = stats({ currentStreak: 0, metDaysTotal: 47, counts: counts(47) });
    const atSeed = stats({ currentStreak: 12, metDaysTotal: 30, counts: counts(30) });

    expect(statsWithBaseline(baseline, atSeed, atSeed).currentStreak).toBe(12);
  });

  it('takes the baseline’s streak when IT knows more — a run longer than the window', () => {
    const baseline = stats({ currentStreak: 155, metDaysTotal: 170, counts: counts(170) });
    const atSeed = stats({ currentStreak: 120, metDaysTotal: 110, counts: counts(110) });

    expect(statsWithBaseline(baseline, atSeed, atSeed).currentStreak).toBe(155);
  });

  it('never reports a longest streak below the current one', () => {
    // A growing run overtakes the record without waiting for a reload.
    const baseline = stats({ currentStreak: 33, longestStreak: 33, metDaysTotal: 47 });
    const live = stats({ ...AT_SEED, currentStreak: 34, longestStreak: 34, counts: counts(31) });

    const spliced = statsWithBaseline(baseline, AT_SEED, live);

    expect(spliced.currentStreak).toBe(34);
    expect(spliced.longestStreak).toBe(34);
  });

  it('keeps the baseline’s longest when the window has forgotten it', () => {
    const baseline = stats({ longestStreak: 88, currentStreak: 2, metDaysTotal: 170 });
    const windowed = stats({ longestStreak: 5, currentStreak: 2, metDaysTotal: 30 });

    expect(statsWithBaseline(baseline, windowed, windowed).longestStreak).toBe(88);
  });

  it('takes the average from the baseline, unadjusted by an in-session edit', () => {
    const live = stats({ ...AT_SEED, averageStreak: 3, counts: counts(31) });

    expect(statsWithBaseline(BASELINE, AT_SEED, live).averageStreak).toBe(14);
  });

  it('falls back to the live average when the baseline has none', () => {
    const baseline = stats({ averageStreak: null, metDaysTotal: 47 });
    const live = stats({ ...AT_SEED, averageStreak: 6 });

    expect(statsWithBaseline(baseline, AT_SEED, live).averageStreak).toBe(6);
  });

  it('takes the hit rate, the allowance and the counts from the live walk', () => {
    // These are window figures: the grid draws exactly the span they cover, so they can be
    // checked against the squares beside them.
    const live = stats({
      ...AT_SEED,
      hitRate: 0.5,
      allowanceRemaining: 0,
      counts: { met: 31, partial: 1, missed: 2, skipped: 3, unknown: 4 },
    });

    const spliced = statsWithBaseline(BASELINE, AT_SEED, live);

    expect(spliced.hitRate).toBe(0.5);
    expect(spliced.allowanceRemaining).toBe(0);
    expect(spliced.counts).toStrictEqual(live.counts);
  });
});
