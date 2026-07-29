/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { APP_WINDOW_DAYS, addDays, todayIn } from '@/lib/habits/dates';
import * as supabaseServer from '@/lib/supabase/server';
import type { Habit, HabitEntry } from '@/lib/types';

import { MAX_PAGES, PAGE_SIZE, getHabitSeed, getHabitsWithHistory } from './habits';

// `import 'server-only'` throws outside a Server Component context; neutralise it under Jest.
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
const mockCreateClient = jest.mocked(supabaseServer.createClient);

const HABITS = [
  { id: 'habit-1', name: 'Morning routine', archived_at: null, sort_order: 1 },
  { id: 'habit-2', name: 'Evening wind-down', archived_at: null, sort_order: 2 },
];

function entry(habitId: string, date: string): HabitEntry {
  return {
    id: `${habitId}-${date}`,
    habit_id: habitId,
    entry_date: date,
    status: 'met',
    results: null,
    note: null,
    created_at: `${date}T08:00:00Z`,
    updated_at: `${date}T08:00:00Z`,
  };
}

/** `count` entries for one habit, dated backwards from a fixed day so each is distinct. */
function entries(habitId: string, count: number): HabitEntry[] {
  return Array.from({ length: count }, (_, index) => entry(habitId, addDays('2026-07-28', -index)));
}

interface Result {
  data: unknown;
  error: { message: string; code?: string } | null;
}

/** What one request asked for, recorded so the query itself can be asserted. */
interface RecordedQuery {
  is?: [string, unknown];
  in?: [string, unknown];
  order: [string, unknown][];
  range?: [number, number];
}

/** The chaining surface `getHabitsWithHistory` uses, over a promise of the request's result. */
type Builder = Promise<Result> & {
  select: () => Builder;
  is: (column: string, value: unknown) => Builder;
  in: (column: string, values: unknown) => Builder;
  order: (column: string, options: unknown) => Builder;
  range: (start: number, end: number) => Builder;
};

/**
 * A stand-in for the Supabase query builder. It IS a promise — the real builder is thenable —
 * with the chaining methods assigned onto it, so `await`ing at the end of any chain resolves
 * the result queued for that request. The reader creates a fresh builder per page, so queueing
 * several `habit_entries` results is how the paging loop is driven.
 */
function makeClient(results: { habits: Result; habit_entries?: Result[] }) {
  const calls: { habits: RecordedQuery[]; habit_entries: RecordedQuery[] } = {
    habits: [],
    habit_entries: [],
  };
  let entryPage = 0;

  const from = jest.fn((table: 'habits' | 'habit_entries') => {
    const recorded: RecordedQuery = { order: [] };
    calls[table].push(recorded);

    let result = results.habits;
    if (table === 'habit_entries') {
      result = results.habit_entries?.[entryPage] ?? { data: [], error: null };
      entryPage += 1;
    }

    const builder: Builder = Object.assign(Promise.resolve(result), {
      select: jest.fn(() => builder),
      is: jest.fn((column: string, value: unknown) => {
        recorded.is = [column, value];
        return builder;
      }),
      in: jest.fn((column: string, values: unknown) => {
        recorded.in = [column, values];
        return builder;
      }),
      order: jest.fn((column: string, options: unknown) => {
        recorded.order.push([column, options]);
        return builder;
      }),
      range: jest.fn((start: number, end: number) => {
        recorded.range = [start, end];
        return builder;
      }),
    });
    return builder;
  });

  return { client: { from } as never, from, calls };
}

/** Point the server-only `createClient` at a stand-in holding `rows` — the seed's whole world. */
function seedFrom(rows: { habits: Result; habit_entries?: Result[] }): void {
  const { client } = makeClient(rows);
  mockCreateClient.mockResolvedValue(client);
}

describe('getHabitsWithHistory', () => {
  it('reads active habits in the app’s display order and groups their entries', async () => {
    const { client, calls } = makeClient({
      habits: { data: HABITS, error: null },
      habit_entries: [
        {
          data: [entry('habit-1', '2026-07-28'), entry('habit-2', '2026-07-27')],
          error: null,
        },
      ],
    });

    const result = await getHabitsWithHistory(client, { includeArchived: false });

    expect(result.error).toBeNull();
    expect(result.habits).toStrictEqual(HABITS);
    expect(result.entriesByHabit.get('habit-1')).toHaveLength(1);
    expect(result.entriesByHabit.get('habit-2')).toHaveLength(1);

    // Archived last, then the app's own sort_order with unsorted habits at the end.
    expect(calls.habits[0]?.is).toStrictEqual(['archived_at', null]);
    expect(calls.habits[0]?.order).toStrictEqual([
      ['archived_at', { ascending: true, nullsFirst: true }],
      ['sort_order', { ascending: true, nullsFirst: false }],
      ['created_at', { ascending: true }],
    ]);
  });

  it('drops the archived filter when archived habits are asked for', async () => {
    const { client, calls } = makeClient({
      habits: { data: HABITS, error: null },
      habit_entries: [{ data: [], error: null }],
    });

    await getHabitsWithHistory(client, { includeArchived: true });

    expect(calls.habits[0]?.is).toBeUndefined();
  });

  it('gives every habit an entry list, including one that has never been logged', async () => {
    const { client } = makeClient({
      habits: { data: HABITS, error: null },
      habit_entries: [{ data: [entry('habit-1', '2026-07-28')], error: null }],
    });

    const result = await getHabitsWithHistory(client, { includeArchived: false });

    expect(result.entriesByHabit.get('habit-2')).toStrictEqual([]);
  });

  it('issues no entry query at all when there are no habits', async () => {
    const { client, calls } = makeClient({ habits: { data: [], error: null } });

    const result = await getHabitsWithHistory(client, { includeArchived: false });

    expect(result.habits).toStrictEqual([]);
    expect(result.entriesByHabit.size).toBe(0);
    expect(calls.habit_entries).toHaveLength(0);
  });

  it('surfaces a habits read failure instead of answering with an empty list', async () => {
    const { client } = makeClient({
      habits: { data: null, error: { message: 'DB unreachable' } },
    });

    const result = await getHabitsWithHistory(client, { includeArchived: false });

    expect(result.error?.message).toBe('DB unreachable');
    expect(result.habits).toStrictEqual([]);
  });

  it('surfaces an entries read failure the same way', async () => {
    const { client } = makeClient({
      habits: { data: HABITS, error: null },
      habit_entries: [{ data: null, error: { message: 'entries exploded' } }],
    });

    const result = await getHabitsWithHistory(client, { includeArchived: false });

    expect(result.error?.message).toBe('entries exploded');
    expect(result.habits).toStrictEqual([]);
  });

  describe('paging', () => {
    it('keeps reading past a full page and returns both pages’ rows', async () => {
      const first = entries('habit-1', PAGE_SIZE);
      const second = entries('habit-2', 5);
      const { client, calls } = makeClient({
        habits: { data: HABITS, error: null },
        habit_entries: [
          { data: first, error: null },
          { data: second, error: null },
        ],
      });

      const result = await getHabitsWithHistory(client, { includeArchived: false });

      expect(result.error).toBeNull();
      expect(result.entriesByHabit.get('habit-1')).toHaveLength(PAGE_SIZE);
      expect(result.entriesByHabit.get('habit-2')).toHaveLength(5);
      // PostgREST's row cap truncates silently, so the window is asked for explicitly and the
      // second request starts exactly where the first stopped.
      expect(calls.habit_entries[0]?.range).toStrictEqual([0, PAGE_SIZE - 1]);
      expect(calls.habit_entries[1]?.range).toStrictEqual([PAGE_SIZE, 2 * PAGE_SIZE - 1]);
    });

    it('spends one extra empty request on a history that is exactly a page long', async () => {
      const { client, calls } = makeClient({
        habits: { data: HABITS, error: null },
        habit_entries: [
          { data: entries('habit-1', PAGE_SIZE), error: null },
          { data: [], error: null },
        ],
      });

      const result = await getHabitsWithHistory(client, { includeArchived: false });

      expect(result.error).toBeNull();
      expect(result.entriesByHabit.get('habit-1')).toHaveLength(PAGE_SIZE);
      expect(calls.habit_entries).toHaveLength(2);
    });

    it('stops after one request when the first page is short', async () => {
      const { client, calls } = makeClient({
        habits: { data: HABITS, error: null },
        habit_entries: [{ data: entries('habit-1', 3), error: null }],
      });

      await getHabitsWithHistory(client, { includeArchived: false });

      expect(calls.habit_entries).toHaveLength(1);
    });

    it('fails loudly rather than truncating when a backend never returns a short page', async () => {
      const { client, calls } = makeClient({
        habits: { data: HABITS, error: null },
        habit_entries: Array.from({ length: MAX_PAGES + 1 }, () => ({
          data: entries('habit-1', PAGE_SIZE),
          error: null,
        })),
      });

      const result = await getHabitsWithHistory(client, { includeArchived: false });

      // A truncated history reads as a shrinking streak, which the coach would then state with
      // full confidence — so the read refuses instead.
      expect(result.error?.code).toBe('PGRST_PAGING');
      expect(result.entriesByHabit.size).toBe(0);
      expect(calls.habit_entries).toHaveLength(MAX_PAGES);
    });
  });
});

/**
 * The shell's seed. `today` is derived from the clock rather than pinned to a literal, because
 * the seed computes its own UTC today — a fixture date would drift out of the window the
 * moment the real calendar moved past it.
 */
describe('getHabitSeed', () => {
  const TODAY = todayIn('UTC');

  /** A daily habit that has been running far longer than the window the client holds. */
  function habit(id: string, name: string, sortOrder: number): Habit {
    return {
      id,
      name,
      notes: null,
      criteria: [{ key: 'done', label: 'Done', kind: 'boolean' }],
      active_days: [1, 2, 3, 4, 5, 6, 7],
      allowance: 1,
      started_on: addDays(TODAY, -300),
      archived_at: null,
      sort_order: sortOrder,
      created_at: '2025-01-01T00:00:00Z',
    };
  }

  const MORNING = habit('habit-1', 'Morning routine', 1);
  const EVENING = habit('habit-2', 'Evening wind-down', 2);

  /** A met entry `daysAgo` before today. */
  function met(habitId: string, daysAgo: number): HabitEntry {
    return entry(habitId, addDays(TODAY, -daysAgo));
  }

  it('windows the entries it hands the client while scoring on all of them', async () => {
    // The one figure this story exists to protect: a day older than the window is absent from
    // the entries yet still banked in the stats.
    seedFrom({
      habits: { data: [MORNING], error: null },
      habit_entries: [{ data: [met(MORNING.id, 200), met(MORNING.id, 1)], error: null }],
    });

    const seed = await getHabitSeed();

    expect(seed.entries.map((row) => row.entry_date)).toStrictEqual([addDays(TODAY, -1)]);
    expect(seed.stats[MORNING.id]?.metDaysTotal).toBe(2);
  });

  it('reaches one day further back than the window the client walks', async () => {
    // A browser west of UTC walks a window ending on the server's YESTERDAY, so the seed has to
    // hold one extra day for that window to stay a subset of what was sent.
    seedFrom({
      habits: { data: [MORNING], error: null },
      habit_entries: [
        {
          data: [met(MORNING.id, APP_WINDOW_DAYS), met(MORNING.id, APP_WINDOW_DAYS + 1)],
          error: null,
        },
      ],
    });

    const seed = await getHabitSeed();

    expect(seed.entries.map((row) => row.entry_date)).toStrictEqual([
      addDays(TODAY, -APP_WINDOW_DAYS),
    ]);
  });

  it('preserves the display order the view renders habits in', async () => {
    seedFrom({
      habits: { data: [MORNING, EVENING], error: null },
      habit_entries: [{ data: [], error: null }],
    });

    const seed = await getHabitSeed();

    expect(seed.habits.map((row) => row.id)).toStrictEqual([MORNING.id, EVENING.id]);
    expect(Object.keys(seed.stats)).toStrictEqual([MORNING.id, EVENING.id]);
  });

  it('answers with nothing at all when there are no habits', async () => {
    seedFrom({ habits: { data: [], error: null } });

    const seed = await getHabitSeed();

    expect(seed).toStrictEqual({ habits: [], entries: [], stats: {} });
  });

  it('degrades to the habits alone when the entry read fails, never to a blank shell', async () => {
    // The rail then renders its live window walk — understated for an old habit, but present.
    seedFrom({
      habits: { data: [MORNING], error: null },
      habit_entries: [{ data: null, error: { message: 'entries exploded' } }],
    });

    const seed = await getHabitSeed();

    expect(seed.habits).toStrictEqual([MORNING]);
    expect(seed.entries).toStrictEqual([]);
    expect(seed.stats).toStrictEqual({});
  });
});
