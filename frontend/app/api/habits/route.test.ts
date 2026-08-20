/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { addDays, todayIn } from '@/lib/habits/dates';
import { pinClock } from '@/lib/pin-clock';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { Habit, HabitEntry } from '@/lib/types';

import { GET, POST } from './route';

// `import 'server-only'` throws outside a Server Component context; the GET handler reaches
// the read layer through it, so neutralise it under Jest.
jest.mock('server-only', () => ({}));
jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

// Pinned before TODAY below, which the route ALSO reads live via `todayIn('UTC')` with no
// injected `now` — deterministic regardless of when the suite runs, not just correct today.
pinClock('2026-07-28T12:00:00.000Z');

const mockCreateClient = jest.mocked(createClient);
const mockCreateAdminClient = jest.mocked(createAdminClient);

const API_KEY = 'test-ingest-key';
const TEST_USER = { id: 'user-123' };

const CRITERIA = [
  { key: 'wake', label: 'Up by 6:15', kind: 'time', target: 375, comparator: 'lte' },
  { key: 'light', label: 'Outside for light', kind: 'boolean' },
];

const SAVED_ROW = {
  id: 'habit-1',
  name: 'Morning routine',
  criteria: CRITERIA,
  active_days: [1, 2, 3, 4, 5, 6, 7],
  allowance: 1,
  started_on: '2026-07-28',
};

interface MockResult {
  data: unknown;
  error: { message: string; code?: string } | undefined;
}

function makeMockSupabase(user: { id: string } | undefined, result: MockResult) {
  const chain = {
    insert: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue(result),
  };
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

function request(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/habits', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const INSERT_OK: MockResult = { data: SAVED_ROW, error: undefined };

/** A signed-in session whose insert succeeds — the happy path every rejection test contrasts. */
function signedIn(result: MockResult = INSERT_OK) {
  const supabase = makeMockSupabase(TEST_USER, result);
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

beforeEach(() => {
  process.env.INGEST_API_KEY = API_KEY;
});

describe('POST /api/habits', () => {
  it('creates a habit and returns 201 with the stored row', async () => {
    const supabase = signedIn();

    const response = await POST(
      request({ name: 'Morning routine', criteria: CRITERIA, allowance: 1 }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toStrictEqual(SAVED_ROW);
    expect(supabase.from).toHaveBeenCalledWith('habits');
    expect(supabase._chain.insert).toHaveBeenCalledWith({
      name: 'Morning routine',
      criteria: CRITERIA,
      allowance: 1,
    });
  });

  it('omits absent fields entirely so the column defaults apply', async () => {
    const supabase = signedIn();

    await POST(request({ name: 'Morning routine', criteria: CRITERIA }), {
      params: Promise.resolve({}),
    });

    expect(supabase._chain.insert).toHaveBeenCalledWith({
      name: 'Morning routine',
      criteria: CRITERIA,
    });
  });

  it('returns 401 without a session', async () => {
    mockCreateClient.mockResolvedValue(
      makeMockSupabase(undefined, { data: undefined, error: undefined }) as never,
    );

    const response = await POST(request({ name: 'x', criteria: CRITERIA }), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(401);
  });

  it('does NOT accept the ingest API key — defining a habit is session-only', async () => {
    mockCreateClient.mockResolvedValue(
      makeMockSupabase(undefined, { data: undefined, error: undefined }) as never,
    );

    const response = await POST(
      request({ name: 'x', criteria: CRITERIA }, { 'x-api-key': API_KEY }),
      { params: Promise.resolve({}) },
    );

    expect(response.status).toBe(401);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  describe('rejects a malformed body with 400', () => {
    it.each([
      ['no criteria at all', { name: 'x', criteria: [] }],
      [
        'duplicate criterion keys',
        {
          name: 'x',
          criteria: [
            { key: 'k', label: 'One', kind: 'boolean' },
            { key: 'k', label: 'Two', kind: 'boolean' },
          ],
        },
      ],
      [
        'a key that is not slug-shaped',
        { name: 'x', criteria: [{ key: 'Not A Key', label: 'One', kind: 'boolean' }] },
      ],
      [
        'a boolean carrying a target',
        {
          name: 'x',
          criteria: [{ key: 'k', label: 'One', kind: 'boolean', target: 5, comparator: 'gte' }],
        },
      ],
      [
        'a measured kind missing its comparator',
        { name: 'x', criteria: [{ key: 'k', label: 'One', kind: 'count', target: 5 }] },
      ],
      [
        'a measured kind missing its target',
        { name: 'x', criteria: [{ key: 'k', label: 'One', kind: 'count', comparator: 'gte' }] },
      ],
      ['a weekday out of range', { name: 'x', criteria: CRITERIA, active_days: [0, 1] }],
      ['an empty weekday set', { name: 'x', criteria: CRITERIA, active_days: [] }],
      ['a repeated weekday', { name: 'x', criteria: CRITERIA, active_days: [1, 1] }],
      ['an allowance above the rolling window', { name: 'x', criteria: CRITERIA, allowance: 8 }],
      ['a negative allowance', { name: 'x', criteria: CRITERIA, allowance: -1 }],
      ['an empty name', { name: ' '.repeat(3), criteria: CRITERIA }],
    ])('%s', async (_case, body) => {
      const supabase = signedIn();

      const response = await POST(request(body), { params: Promise.resolve({}) });

      expect(response.status).toBe(400);
      expect(supabase._chain.insert).not.toHaveBeenCalled();
    });
  });

  it('maps a Supabase failure through the shared error envelope', async () => {
    signedIn({ data: undefined, error: { message: 'DB exploded' } });

    const response = await POST(request({ name: 'x', criteria: CRITERIA }), {
      params: Promise.resolve({}),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({ error: 'DB exploded' });
  });
});

// ---------------------------------------------------------------------------
// GET /api/habits — the coach's read.
// ---------------------------------------------------------------------------

/** Today in UTC, which is what the handler resolves for a caller naming no zone. */
const TODAY = todayIn('UTC');

const READ_HABIT: Habit = {
  id: 'habit-1',
  name: 'Morning routine',
  notes: null,
  criteria: CRITERIA,
  active_days: [1, 2, 3, 4, 5, 6, 7],
  allowance: 1,
  started_on: addDays(TODAY, -6),
  archived_at: null,
  sort_order: 1,
  created_at: '2026-06-15T00:00:00Z',
};

const ARCHIVED_HABIT: Habit = {
  ...READ_HABIT,
  id: 'habit-2',
  name: 'Retired routine',
  archived_at: `${addDays(TODAY, -1)}T12:00:00Z`,
  sort_order: 2,
};

function readEntry(date: string, overrides: Partial<HabitEntry> = {}): HabitEntry {
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

/** The seven days ending today, all met — a run whose numbers are easy to state. */
const WEEK = Array.from({ length: 7 }, (_, index) => readEntry(addDays(TODAY, -index)));

interface ReadResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

/** The chaining surface the read path uses, over a promise of that request's result. */
type ReadBuilder = Promise<ReadResult> & {
  select: () => ReadBuilder;
  is: () => ReadBuilder;
  in: () => ReadBuilder;
  order: () => ReadBuilder;
  range: () => ReadBuilder;
};

/**
 * A read-only stand-in for the query builder. It IS a promise — the real builder is thenable —
 * with the chaining methods assigned onto it, so awaiting the end of any chain yields the
 * result for that table. The entry read stops on the first short page, so one page per table is
 * enough here; paging itself is pinned in the data layer's own tests.
 */
function makeReadSupabase(
  user: { id: string } | undefined,
  tables: { habits: ReadResult; habit_entries?: ReadResult },
) {
  const from = jest.fn((table: 'habits' | 'habit_entries') => {
    const result =
      table === 'habits' ? tables.habits : (tables.habit_entries ?? { data: [], error: null });
    const builder: ReadBuilder = Object.assign(Promise.resolve(result), {
      select: jest.fn(() => builder),
      is: jest.fn(() => builder),
      in: jest.fn(() => builder),
      order: jest.fn(() => builder),
      range: jest.fn(() => builder),
    });
    return builder;
  });

  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) }, from };
}

/** A signed-in browser session whose read returns `habits` and `entries`. */
function readableSession(habits: Habit[] = [READ_HABIT], entries: HabitEntry[] = WEEK) {
  const supabase = makeReadSupabase(TEST_USER, {
    habits: { data: habits, error: null },
    habit_entries: { data: entries, error: null },
  });
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

/** The admin client a keyed caller must be served by, with no session behind it. */
function readableAdmin(habits: Habit[] = [READ_HABIT], entries: HabitEntry[] = WEEK) {
  mockCreateClient.mockResolvedValue(
    makeReadSupabase(undefined, { habits: { data: [], error: null } }) as never,
  );
  const admin = makeReadSupabase(undefined, {
    habits: { data: habits, error: null },
    habit_entries: { data: entries, error: null },
  });
  mockCreateAdminClient.mockReturnValue(admin as never);
  return admin;
}

function getRequest(query = '', headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/habits${query}`, { headers });
}

describe('GET /api/habits', () => {
  describe('auth', () => {
    it('serves a browser session through the session client', async () => {
      const supabase = readableSession();

      const response = await GET(getRequest());

      expect(response.status).toBe(200);
      expect(supabase.from).toHaveBeenCalledWith('habits');
      expect(mockCreateAdminClient).not.toHaveBeenCalled();
    });

    it('serves a valid key with no session through the ADMIN client', async () => {
      // The whole point of resolveIngestClient here: a keyed caller carries no cookie, so a
      // session client would read anonymously and answer 200 with an empty list.
      const admin = readableAdmin();

      const response = await GET(getRequest('', { 'x-api-key': API_KEY }));
      const body = (await response.json()) as { habits: unknown[] };

      expect(response.status).toBe(200);
      expect(admin.from).toHaveBeenCalledWith('habits');
      expect(body.habits).toHaveLength(1);
    });

    it('returns 401 with neither a key nor a session', async () => {
      mockCreateClient.mockResolvedValue(
        makeReadSupabase(undefined, { habits: { data: [], error: null } }) as never,
      );

      const response = await GET(getRequest());

      expect(response.status).toBe(401);
      expect(await response.json()).toStrictEqual({ error: 'Unauthorized' });
    });

    it('rejects a wrong x-api-key even beside a correct bearer token', async () => {
      mockCreateClient.mockResolvedValue(
        makeReadSupabase(undefined, { habits: { data: [], error: null } }) as never,
      );

      const response = await GET(
        getRequest('', { 'x-api-key': 'wrong', authorization: `Bearer ${API_KEY}` }),
      );

      expect(response.status).toBe(401);
      expect(mockCreateAdminClient).not.toHaveBeenCalled();
    });

    it('treats an empty x-api-key as a mismatch, not an absent header', async () => {
      mockCreateClient.mockResolvedValue(
        makeReadSupabase(undefined, { habits: { data: [], error: null } }) as never,
      );

      const response = await GET(
        getRequest('', { 'x-api-key': '', authorization: `Bearer ${API_KEY}` }),
      );

      expect(response.status).toBe(401);
    });
  });

  describe('the window', () => {
    it('defaults to the trailing 90 days ending today', async () => {
      readableSession();

      const response = await GET(getRequest());
      const body = (await response.json()) as {
        today: string;
        window: { from: string; to: string };
      };

      expect(body.today).toBe(TODAY);
      expect(body.window).toStrictEqual({ from: addDays(TODAY, -89), to: TODAY });
    });

    it('clamps a to after today back to today and echoes the window it used', async () => {
      readableSession();

      const response = await GET(getRequest(`?from=${addDays(TODAY, -10)}&to=2099-01-01`));
      const body = (await response.json()) as { window: { from: string; to: string } };

      expect(body.window).toStrictEqual({ from: addDays(TODAY, -10), to: TODAY });
    });

    it('bounds the entries returned to the window', async () => {
      readableSession();

      const response = await GET(getRequest(`?from=${addDays(TODAY, -2)}`));
      const body = (await response.json()) as { habits: { entries: { date: string }[] }[] };

      expect(body.habits[0]?.entries.map((entry) => entry.date)).toStrictEqual([
        TODAY,
        addDays(TODAY, -1),
        addDays(TODAY, -2),
      ]);
    });

    it.each([
      ['an unparseable from', '?from=last-tuesday'],
      ['a from after to', `?from=${TODAY}&to=${addDays(TODAY, -1)}`],
      ['a span over the cap', `?from=${addDays(TODAY, -400)}`],
      ['a junk include_archived', '?include_archived=yes'],
    ])('rejects %s with 400', async (_case, query) => {
      readableSession();

      const response = await GET(getRequest(query));

      expect(response.status).toBe(400);
    });

    it('names the cap rather than trimming an oversized window', async () => {
      readableSession();

      const response = await GET(getRequest(`?from=${addDays(TODAY, -400)}`));

      expect(await response.json()).toStrictEqual({
        error: 'The window must not exceed 366 days',
      });
    });
  });

  describe('the timezone', () => {
    it('echoes a valid zone and resolves today in it', async () => {
      readableSession();

      const response = await GET(getRequest('?tz=Asia/Tokyo'));
      const body = (await response.json()) as { timezone: string; today: string };

      expect(body.timezone).toBe('Asia/Tokyo');
      expect(body.today).toBe(todayIn('Asia/Tokyo'));
    });

    it('falls back to UTC on an unrecognized zone and echoes UTC, not the request', async () => {
      readableSession();

      const response = await GET(getRequest('?tz=Mars/Olympus_Mons'));
      const body = (await response.json()) as { timezone: string };

      expect(body.timezone).toBe('UTC');
    });
  });

  describe('include_archived', () => {
    it('excludes archived habits by default', async () => {
      // The data layer applies the filter; the route's job is not to ask for them.
      readableSession([READ_HABIT]);

      const response = await GET(getRequest());
      const body = (await response.json()) as { habits: { id: string }[] };

      expect(body.habits.map((habit) => habit.id)).toStrictEqual(['habit-1']);
    });

    it('carries archived habits with their archived_at when asked for', async () => {
      readableSession([READ_HABIT, ARCHIVED_HABIT]);

      const response = await GET(getRequest('?include_archived=true'));
      const body = (await response.json()) as { habits: { id: string; archived_at: unknown }[] };

      expect(body.habits.map((habit) => habit.id)).toStrictEqual(['habit-1', 'habit-2']);
      expect(body.habits[1]?.archived_at).toBe(ARCHIVED_HABIT.archived_at);
    });
  });

  describe('the payload', () => {
    it('returns the derived numbers the app shows, from the one engine', async () => {
      readableSession();

      const response = await GET(getRequest());
      const body = (await response.json()) as { habits: { stats: Record<string, unknown> }[] };

      // Seven met days from started_on to today, allowance untouched.
      expect(body.habits[0]?.stats).toStrictEqual({
        current_streak: 7,
        longest_streak: 7,
        average_streak: 7,
        allowance_remaining: 1,
        hit_rate: 1,
        met_days_total: 7,
        stage: 'fully_deliberate',
        met: 7,
        partial: 0,
        missed: 0,
        skipped: 0,
        unknown: 0,
      });
    });

    it('projects entries to exactly four keys, newest first', async () => {
      readableSession();

      const response = await GET(getRequest());
      const body = (await response.json()) as { habits: { entries: Record<string, unknown>[] }[] };
      const entries = body.habits[0]?.entries ?? [];

      expect(entries[0]?.['date']).toBe(TODAY);
      expect(Object.keys(entries[0] ?? {})).toStrictEqual(['date', 'status', 'results', 'note']);
    });

    it('keeps the streak scalars identical across two different windows', async () => {
      interface StatsBody {
        habits: { stats: Record<string, unknown> }[];
      }

      readableSession();
      const wideResponse = await GET(getRequest(`?from=${addDays(TODAY, -60)}`));
      const wide = (await wideResponse.json()) as StatsBody;

      readableSession();
      const narrowResponse = await GET(getRequest(`?from=${TODAY}`));
      const narrow = (await narrowResponse.json()) as StatsBody;

      for (const key of ['current_streak', 'longest_streak', 'met_days_total', 'stage']) {
        expect(narrow.habits[0]?.stats[key]).toStrictEqual(wide.habits[0]?.stats[key]);
      }
      // The windowed figures do move — otherwise the assertion above proves nothing.
      expect(narrow.habits[0]?.stats['met']).toBe(1);
      expect(wide.habits[0]?.stats['met']).toBe(7);
    });

    it('answers an empty database with 200 and an empty list', async () => {
      readableSession([], []);

      const response = await GET(getRequest());

      expect(response.status).toBe(200);
      expect(await response.json()).toStrictEqual({
        today: TODAY,
        timezone: 'UTC',
        window: { from: addDays(TODAY, -89), to: TODAY },
        habits: [],
      });
    });
  });

  it('maps a database failure to a 5xx rather than an empty list', async () => {
    const supabase = makeReadSupabase(TEST_USER, {
      habits: { data: null, error: { message: 'DB unreachable' } },
    });
    mockCreateClient.mockResolvedValue(supabase as never);

    const response = await GET(getRequest());

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({ error: 'DB unreachable' });
  });
});
