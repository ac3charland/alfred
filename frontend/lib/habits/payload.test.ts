import { toHabitsPayload } from '@/lib/habits/payload';
import type { HabitStats } from '@/lib/habits/types';
import type { Habit, HabitEntry } from '@/lib/types';

/**
 * The payload is a PUBLISHED contract read by a consumer outside this repo, so these tests are
 * deliberately literal about key names, nesting and rounding: every key here is one that can't
 * change quietly.
 */

const WAKE = { key: 'wake', label: 'Up by 6:15', kind: 'time', target: 375, comparator: 'lte' };
const LIGHT = { key: 'light', label: 'Outside for light', kind: 'boolean' };
const CRITERIA = [WAKE, LIGHT];

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-1',
    name: 'Morning routine',
    notes: null,
    criteria: CRITERIA,
    active_days: [1, 2, 3, 4, 5, 6, 7],
    allowance: 1,
    started_on: '2026-06-15',
    archived_at: null,
    sort_order: null,
    created_at: '2026-06-15T00:00:00Z',
    ...overrides,
  };
}

function makeEntry(date: string, overrides: Partial<HabitEntry> = {}): HabitEntry {
  return {
    id: `entry-${date}`,
    habit_id: 'habit-1',
    entry_date: date,
    status: 'met',
    results: { wake: 364, light: true },
    note: null,
    created_at: `${date}T08:00:00Z`,
    updated_at: `${date}T08:00:00Z`,
    ...overrides,
  };
}

function makeStats(overrides: Partial<HabitStats> = {}): HabitStats {
  return {
    currentStreak: 33,
    longestStreak: 33,
    averageStreak: 14,
    allowanceRemaining: 1,
    hitRate: 0.94,
    metDaysTotal: 47,
    stage: 'nearing_automaticity',
    counts: { met: 47, partial: 2, missed: 1, skipped: 0, unknown: 0 },
    ...overrides,
  };
}

const WINDOW = { from: '2026-05-01', to: '2026-07-28' };

function payloadFor(habits: Parameters<typeof toHabitsPayload>[0]['habits']) {
  return toHabitsPayload({
    today: '2026-07-28',
    timezone: 'America/New_York',
    window: WINDOW,
    habits,
  });
}

describe('toHabitsPayload', () => {
  it('lays the response out exactly as the published contract describes it', () => {
    const payload = payloadFor([
      {
        habit: makeHabit(),
        stats: makeStats(),
        entries: [makeEntry('2026-07-28')],
      },
    ]);

    expect(payload).toStrictEqual({
      today: '2026-07-28',
      timezone: 'America/New_York',
      window: { from: '2026-05-01', to: '2026-07-28' },
      habits: [
        {
          id: 'habit-1',
          name: 'Morning routine',
          notes: null,
          criteria: CRITERIA,
          active_days: [1, 2, 3, 4, 5, 6, 7],
          allowance: 1,
          started_on: '2026-06-15',
          archived_at: null,
          stats: {
            current_streak: 33,
            longest_streak: 33,
            average_streak: 14,
            allowance_remaining: 1,
            hit_rate: 0.94,
            met_days_total: 47,
            stage: 'nearing_automaticity',
            met: 47,
            partial: 2,
            missed: 1,
            skipped: 0,
            unknown: 0,
          },
          entries: [
            {
              date: '2026-07-28',
              status: 'met',
              results: { wake: 364, light: true },
              note: null,
            },
          ],
        },
      ],
    });
  });

  it('carries an empty habits list rather than omitting the key', () => {
    expect(payloadFor([])).toStrictEqual({
      today: '2026-07-28',
      timezone: 'America/New_York',
      window: WINDOW,
      habits: [],
    });
  });

  it('keeps row identity and timestamps out of the entries', () => {
    const payload = payloadFor([
      { habit: makeHabit(), stats: makeStats(), entries: [makeEntry('2026-07-28')] },
    ]);

    // A day is addressed by (habit id, date) — which is what the upsert route takes — so the
    // row's own id would be a key nobody could use and we could never change.
    expect(Object.keys(payload.habits[0]?.entries[0] ?? {})).toStrictEqual([
      'date',
      'status',
      'results',
      'note',
    ]);
  });

  it('orders entries newest first whatever order they arrive in', () => {
    const payload = payloadFor([
      {
        habit: makeHabit(),
        stats: makeStats(),
        entries: [makeEntry('2026-07-26'), makeEntry('2026-07-28'), makeEntry('2026-07-27')],
      },
    ]);

    expect(payload.habits[0]?.entries.map((entry) => entry.date)).toStrictEqual([
      '2026-07-28',
      '2026-07-27',
      '2026-07-26',
    ]);
  });

  it('pre-rounds the hit rate to 3 dp and the average streak to 1 dp', () => {
    const payload = payloadFor([
      {
        habit: makeHabit(),
        stats: makeStats({ hitRate: 2 / 3, averageStreak: 14 / 3 }),
        entries: [],
      },
    ]);

    // Quotable directly: 66.7%, and a mean of whole-day runs to a tenth of a day.
    expect(payload.habits[0]?.stats.hit_rate).toBe(0.667);
    expect(payload.habits[0]?.stats.average_streak).toBe(4.7);
  });

  it('keeps a null hit rate and a null average streak null rather than zeroing them', () => {
    const payload = payloadFor([
      { habit: makeHabit(), stats: makeStats({ hitRate: null, averageStreak: null }), entries: [] },
    ]);

    expect(payload.habits[0]?.stats.hit_rate).toBeNull();
    expect(payload.habits[0]?.stats.average_streak).toBeNull();
  });

  it('passes a habit’s own nullable fields through as null', () => {
    const payload = payloadFor([
      {
        habit: makeHabit({ notes: null, archived_at: null }),
        stats: makeStats(),
        entries: [makeEntry('2026-07-26', { results: null, note: 'travel', status: 'skipped' })],
      },
    ]);

    expect(payload.habits[0]?.notes).toBeNull();
    expect(payload.habits[0]?.archived_at).toBeNull();
    expect(payload.habits[0]?.entries[0]).toStrictEqual({
      date: '2026-07-26',
      status: 'skipped',
      results: null,
      note: 'travel',
    });
  });

  it('carries an archived habit’s archived_at through', () => {
    const payload = payloadFor([
      {
        habit: makeHabit({ archived_at: '2026-07-01T12:00:00Z' }),
        stats: makeStats(),
        entries: [],
      },
    ]);

    expect(payload.habits[0]?.archived_at).toBe('2026-07-01T12:00:00Z');
  });

  it('drops a malformed criterion rather than shipping it', () => {
    // The write schema is the gate; the reader's tolerance keeps one bad element from
    // blanking a whole habit's definition.
    const payload = payloadFor([
      {
        habit: makeHabit({ criteria: [LIGHT, { key: 'broken' }] }),
        stats: makeStats(),
        entries: [],
      },
    ]);

    expect(payload.habits[0]?.criteria).toStrictEqual([LIGHT]);
  });
});
