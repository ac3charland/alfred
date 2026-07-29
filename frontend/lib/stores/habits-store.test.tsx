import { act, renderHook, waitFor } from '@testing-library/react';
import * as React from 'react';

import * as apiClient from '@/lib/api-client';
import { todayIn } from '@/lib/habits';
import type { HabitStats } from '@/lib/habits';
import type { Habit, HabitEntry } from '@/lib/types';

import {
  HabitsProvider,
  groupEntries,
  habitsReducer,
  useHabitActions,
  useHabitEntries,
  useHabitStats,
  useHabits,
  useHabitsToday,
  useUnloggedTodayCount,
} from './habits-store';

jest.mock('@/lib/api-client');
const mockCreateHabit = jest.mocked(apiClient.createHabit);
const mockUpsertHabitEntry = jest.mocked(apiClient.upsertHabitEntry);

// Short-circuit the toast context so a failed write's message is assertable without a
// ToastProvider wrapper — the pattern the other store tests use.
const mockShowToast = jest.fn();
jest.mock('@/lib/stores/toast-store', () => ({
  ...jest.requireActual<typeof import('@/lib/stores/toast-store')>('@/lib/stores/toast-store'),
  useToastActions: () => ({ showToast: mockShowToast, dismissToast: jest.fn() }),
}));

/** Placeholder until the promise executor hands over the real resolver, one tick later. */
function noop(): void {
  return undefined;
}

/**
 * Derived from the clock, never a literal: the provider corrects `today` to the BROWSER's date
 * in a mount effect, so a hard-coded fixture silently stops matching the moment the real date
 * rolls past it — the test would pass all day and fail after midnight.
 */
const TODAY = todayIn(Intl.DateTimeFormat().resolvedOptions().timeZone);

const MORNING: Habit = {
  id: 'habit-1',
  name: 'Morning routine',
  notes: null,
  criteria: [
    { key: 'wake', label: 'Up by 6:15', kind: 'time', target: 375, comparator: 'lte' },
    { key: 'light', label: 'Outside for light', kind: 'boolean' },
  ],
  active_days: [1, 2, 3, 4, 5, 6, 7],
  allowance: 1,
  started_on: '2026-07-01',
  archived_at: null,
  sort_order: null,
  created_at: '2026-07-01T00:00:00Z',
};

function makeEntry(overrides: Partial<HabitEntry> = {}): HabitEntry {
  return {
    id: 'entry-1',
    habit_id: MORNING.id,
    entry_date: TODAY,
    status: 'met',
    results: { wake: 364, light: true },
    note: null,
    created_at: `${TODAY}T08:00:00Z`,
    updated_at: `${TODAY}T08:00:00Z`,
    ...overrides,
  };
}

function makeWrapper(
  habits: Habit[],
  entries: HabitEntry[] = [],
  stats: Record<string, HabitStats> = {},
) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <HabitsProvider
        initialHabits={habits}
        initialEntries={entries}
        initialStats={stats}
        serverToday={TODAY}
      >
        {children}
      </HabitsProvider>
    );
  };
}

function useStoreTest() {
  return {
    habits: useHabits(),
    entries: useHabitEntries(MORNING.id),
    today: useHabitsToday(),
    unlogged: useUnloggedTodayCount(),
    stats: useHabitStats(MORNING),
    actions: useHabitActions(),
  };
}

/**
 * A promise the test resolves by hand — the seam that lets an assertion run while the write is
 * still in flight, which is the only moment the optimistic row is observable on its own.
 */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let settle: (value: T) => void = noop;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      settle(value);
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('habitsReducer', () => {
  const empty = { habits: [], entries: {}, today: TODAY, seedEntries: {}, baselineStats: {} };

  it('inserts, replaces and removes a habit', () => {
    const inserted = habitsReducer(empty, { type: 'insertHabit', habit: MORNING });
    expect(inserted.habits).toStrictEqual([MORNING]);

    const renamed = { ...MORNING, name: 'Evening routine' };
    expect(
      habitsReducer(inserted, { type: 'replaceHabit', id: MORNING.id, habit: renamed }).habits,
    ).toStrictEqual([renamed]);

    expect(habitsReducer(inserted, { type: 'removeHabit', id: MORNING.id }).habits).toStrictEqual(
      [],
    );
  });

  it('drops a removed habit’s entries with it', () => {
    const seeded = { ...empty, habits: [MORNING], entries: groupEntries([makeEntry()]) };
    expect(habitsReducer(seeded, { type: 'removeHabit', id: MORNING.id }).entries).toStrictEqual(
      {},
    );
  });

  it('keys entries by date, so a reconcile replaces the optimistic row rather than adding one', () => {
    const optimistic = makeEntry({ id: 'temp-1', status: 'partial' });
    const saved = makeEntry({ id: 'entry-9' });
    const withOptimistic = habitsReducer(empty, {
      type: 'putEntry',
      habitId: MORNING.id,
      entry: optimistic,
    });
    const reconciled = habitsReducer(withOptimistic, {
      type: 'putEntry',
      habitId: MORNING.id,
      entry: saved,
    });
    expect(reconciled.entries[MORNING.id]).toStrictEqual({ [TODAY]: saved });
  });

  it('moves one habit’s start without touching the rest of its definition', () => {
    const seeded = { ...empty, habits: [MORNING, { ...MORNING, id: 'habit-2' }] };
    const after = habitsReducer(seeded, {
      type: 'setHabitStart',
      id: MORNING.id,
      startedOn: '2026-06-20',
    });
    expect(after.habits[0]).toStrictEqual({ ...MORNING, started_on: '2026-06-20' });
    expect(after.habits[1]?.started_on).toBe('2026-07-01');
  });

  it('removes one day without disturbing the others', () => {
    const seeded = {
      ...empty,
      entries: groupEntries([makeEntry(), makeEntry({ id: 'e-2', entry_date: '2026-07-27' })]),
    };
    const after = habitsReducer(seeded, {
      type: 'removeEntry',
      habitId: MORNING.id,
      date: TODAY,
    });
    expect(Object.keys(after.entries[MORNING.id] ?? {})).toStrictEqual(['2026-07-27']);
  });
});

describe('groupEntries', () => {
  it('nests the flat seed by habit and then by date', () => {
    expect(
      groupEntries([makeEntry(), makeEntry({ id: 'e-2', habit_id: 'habit-2' })]),
    ).toStrictEqual({
      'habit-1': { [TODAY]: makeEntry() },
      'habit-2': { [TODAY]: makeEntry({ id: 'e-2', habit_id: 'habit-2' }) },
    });
  });
});

describe('addHabit', () => {
  it('shows the habit before the request settles, then reconciles with the saved row', async () => {
    const saved: Habit = { ...MORNING, id: 'server-1' };
    const write = deferred<Habit>();
    mockCreateHabit.mockReturnValue(write.promise);
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([]) });

    let pending: Promise<Habit> | undefined;
    act(() => {
      pending = result.current.actions.addHabit({ name: 'Morning routine', criteria: [] });
    });

    expect(result.current.habits).toHaveLength(1);
    expect(result.current.habits[0]?.name).toBe('Morning routine');
    expect(result.current.habits[0]?.id).not.toBe('server-1');

    await act(async () => {
      write.resolve(saved);
      await pending;
    });

    expect(result.current.habits).toStrictEqual([saved]);
  });

  it('rolls the habit back and toasts when the write fails', async () => {
    mockCreateHabit.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([]) });

    await act(async () => {
      await expect(
        result.current.actions.addHabit({ name: 'Morning routine', criteria: [] }),
      ).rejects.toThrow('nope');
    });

    expect(result.current.habits).toStrictEqual([]);
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't create habit");
  });
});

describe('logDay', () => {
  it('paints the derived status before the request settles, using the same rules the route will', async () => {
    const write = deferred<HabitEntry>();
    mockUpsertHabitEntry.mockReturnValue(write.promise);
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([MORNING]) });

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.actions.logDay(MORNING.id, TODAY, { wake: 364, light: false });
    });

    // One of two criteria passes → partial, derived locally with no server round-trip.
    expect(result.current.entries[TODAY]?.status).toBe('partial');

    const saved = makeEntry({ status: 'partial', results: { wake: 364, light: false } });
    await act(async () => {
      write.resolve(saved);
      await pending;
    });

    expect(result.current.entries[TODAY]).toStrictEqual(saved);
  });

  it('leaves the day unlogged again when a first write fails, and toasts', async () => {
    mockUpsertHabitEntry.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([MORNING]) });

    await act(async () => {
      await expect(
        result.current.actions.logDay(MORNING.id, TODAY, { light: true }),
      ).rejects.toThrow('nope');
    });

    expect(result.current.entries[TODAY]).toBeUndefined();
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't save that day");
  });

  it('moves the habit’s start back when the day logged is behind it', async () => {
    const write = deferred<HabitEntry>();
    mockUpsertHabitEntry.mockReturnValue(write.promise);
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([MORNING]) });

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.actions.logDay(MORNING.id, '2026-06-20', { light: true });
    });

    // The same rule the route applies, run locally — so the days in between repaint as part of
    // the habit's life on the tap, not a round-trip later.
    expect(result.current.habits[0]?.started_on).toBe('2026-06-20');

    await act(async () => {
      write.resolve(makeEntry({ entry_date: '2026-06-20' }));
      await pending;
    });

    expect(result.current.habits[0]?.started_on).toBe('2026-06-20');
  });

  it('puts the start back where it was when a backfill fails', async () => {
    mockUpsertHabitEntry.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([MORNING]) });

    await act(async () => {
      await expect(
        result.current.actions.logDay(MORNING.id, '2026-06-20', { light: true }),
      ).rejects.toThrow('nope');
    });

    expect(result.current.habits[0]?.started_on).toBe('2026-07-01');
    expect(result.current.entries['2026-06-20']).toBeUndefined();
  });

  it('leaves the start alone for a day the habit was already running on', async () => {
    mockUpsertHabitEntry.mockResolvedValue(makeEntry());
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([MORNING]) });

    await act(async () => {
      await result.current.actions.logDay(MORNING.id, TODAY, { light: true });
    });

    expect(result.current.habits[0]?.started_on).toBe('2026-07-01');
  });

  it('restores the row a failed CORRECTION replaced', async () => {
    const original = makeEntry();
    mockUpsertHabitEntry.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(useStoreTest, {
      wrapper: makeWrapper([MORNING], [original]),
    });

    await act(async () => {
      await expect(
        result.current.actions.logDay(MORNING.id, TODAY, { wake: 700, light: false }),
      ).rejects.toThrow('nope');
    });

    expect(result.current.entries[TODAY]).toStrictEqual(original);
  });
});

describe('skipDay', () => {
  it('sends the reason as the entry’s note and paints the skip immediately', async () => {
    const saved = makeEntry({ status: 'skipped', results: null, note: 'flu' });
    mockUpsertHabitEntry.mockResolvedValue(saved);
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([MORNING]) });

    await act(async () => {
      await result.current.actions.skipDay(MORNING.id, TODAY, 'flu');
    });

    expect(mockUpsertHabitEntry).toHaveBeenCalledWith(MORNING.id, {
      date: TODAY,
      status: 'skipped',
      note: 'flu',
    });
    expect(result.current.entries[TODAY]).toStrictEqual(saved);
  });

  it('moves the start back for a pre-start skip too — the same rule as a logged day', async () => {
    mockUpsertHabitEntry.mockResolvedValue(
      makeEntry({ entry_date: '2026-06-20', status: 'skipped', results: null, note: 'travelling' }),
    );
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([MORNING]) });

    await act(async () => {
      await result.current.actions.skipDay(MORNING.id, '2026-06-20', 'travelling');
    });

    expect(result.current.habits[0]?.started_on).toBe('2026-06-20');
  });

  it('rolls back and toasts when the skip fails', async () => {
    mockUpsertHabitEntry.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([MORNING]) });

    await act(async () => {
      await expect(result.current.actions.skipDay(MORNING.id, TODAY, 'flu')).rejects.toThrow(
        'nope',
      );
    });

    expect(result.current.entries[TODAY]).toBeUndefined();
    expect(mockShowToast).toHaveBeenCalledWith("Couldn't skip that day");
  });
});

describe('useUnloggedTodayCount', () => {
  it('counts a habit that runs today and has no row yet', () => {
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([MORNING]) });
    expect(result.current.unlogged).toBe(1);
  });

  it('does not count a habit already logged today, whatever the verdict', () => {
    const { result } = renderHook(useStoreTest, {
      wrapper: makeWrapper([MORNING], [makeEntry({ status: 'missed' })]),
    });
    expect(result.current.unlogged).toBe(0);
  });

  it('does not count a habit that today is not applicable to', () => {
    // 2026-07-28 is a Tuesday; this habit only runs on Mondays.
    const mondays: Habit = { ...MORNING, active_days: [1] };
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([mondays]) });
    expect(result.current.unlogged).toBe(0);
  });

  it('does not count a habit that has not started yet', () => {
    const future: Habit = { ...MORNING, started_on: '2026-08-01' };
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([future]) });
    expect(result.current.unlogged).toBe(0);
  });

  it('falls to zero the moment the day is logged', async () => {
    mockUpsertHabitEntry.mockResolvedValue(makeEntry());
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([MORNING]) });
    expect(result.current.unlogged).toBe(1);

    await act(async () => {
      await result.current.actions.logDay(MORNING.id, TODAY, { wake: 364, light: true });
    });

    expect(result.current.unlogged).toBe(0);
  });
});

describe('today', () => {
  it('starts on the server’s date so first paint matches, then corrects to the browser zone', async () => {
    const resolved = Intl.DateTimeFormat().resolvedOptions();
    jest
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockReturnValue({ ...resolved, timeZone: 'Asia/Tokyo' });
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([MORNING]) });

    const tokyoToday = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());

    await waitFor(() => {
      expect(result.current.today).toBe(tokyoToday);
    });
    jest.restoreAllMocks();
  });
});

describe('useHabitStats', () => {
  /** The server's all-history answer for a habit far older than the seeded window. */
  const BASELINE: HabitStats = {
    currentStreak: 33,
    longestStreak: 40,
    averageStreak: 14,
    allowanceRemaining: 1,
    hitRate: 0.9,
    metDaysTotal: 47,
    stage: 'nearing_automaticity',
    counts: { met: 47, partial: 2, missed: 3, skipped: 0, unknown: 0 },
  };

  it('shows the server’s all-history figures at rest, not the window-truncated ones', () => {
    // The window holds nothing, so a walk on its own would report a longest streak of 0 and
    // demote the habit to the bottom rung — the exact failure the baseline exists to prevent.
    const { result } = renderHook(useStoreTest, {
      wrapper: makeWrapper([MORNING], [], { [MORNING.id]: BASELINE }),
    });

    expect(result.current.stats.longestStreak).toBe(40);
    expect(result.current.stats.metDaysTotal).toBe(47);
    expect(result.current.stats.averageStreak).toBe(14);
    expect(result.current.stats.stage).toBe('nearing_automaticity');
  });

  it('moves the figures optimistically, before the API resolves', async () => {
    const write = deferred<HabitEntry>();
    mockUpsertHabitEntry.mockReturnValue(write.promise);
    const { result } = renderHook(useStoreTest, {
      wrapper: makeWrapper([MORNING], [], { [MORNING.id]: BASELINE }),
    });

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.actions.logDay(MORNING.id, TODAY, { wake: 364, light: true });
    });

    // Both criteria pass → a met day, so one more banked day and one more of streak, with no
    // refetch and nothing waiting on the server.
    expect(result.current.stats.metDaysTotal).toBe(48);
    expect(result.current.stats.currentStreak).toBe(34);

    await act(async () => {
      write.resolve(makeEntry());
      await pending;
    });

    expect(result.current.stats.metDaysTotal).toBe(48);
  });

  it('rolls the figures back with the entry when the write fails', async () => {
    mockUpsertHabitEntry.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(useStoreTest, {
      wrapper: makeWrapper([MORNING], [], { [MORNING.id]: BASELINE }),
    });

    await act(async () => {
      await expect(
        result.current.actions.logDay(MORNING.id, TODAY, { wake: 364, light: true }),
      ).rejects.toThrow('nope');
    });

    expect(result.current.stats.metDaysTotal).toBe(47);
    expect(result.current.stats.currentStreak).toBe(33);
  });

  it('gives a habit created this session pure window stats, with no baseline at all', async () => {
    mockUpsertHabitEntry.mockResolvedValue(makeEntry());
    const { result } = renderHook(useStoreTest, { wrapper: makeWrapper([MORNING]) });

    expect(result.current.stats.metDaysTotal).toBe(0);
    expect(result.current.stats.stage).toBe('fully_deliberate');
    expect(result.current.stats.averageStreak).toBeNull();

    await act(async () => {
      await result.current.actions.logDay(MORNING.id, TODAY, { wake: 364, light: true });
    });

    expect(result.current.stats.metDaysTotal).toBe(1);
    expect(result.current.stats.currentStreak).toBe(1);
  });
});
