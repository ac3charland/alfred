/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { PUT } from './route';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);
const mockCreateAdminClient = jest.mocked(createAdminClient);

const API_KEY = 'test-ingest-key';
const TEST_USER = { id: 'user-123' };
const HABIT_ID = '11111111-1111-4111-8111-111111111111';

const HABIT = {
  criteria: [
    { key: 'wake', label: 'Up by 6:15', kind: 'time', target: 375, comparator: 'lte' },
    { key: 'light', label: 'Outside for light', kind: 'boolean' },
  ],
  started_on: '2026-07-01',
  archived_at: null,
};

interface Options {
  /** No session at all — distinct from omitting `user`, which would take the default. */
  signedOut?: boolean;
  habit?: unknown;
  loadError?: { message: string; code?: string } | undefined;
  upsertError?: { message: string; code?: string } | undefined;
  /** The habits UPDATE that moves `started_on` back behind a backfilled day. */
  startMoveError?: { message: string; code?: string } | undefined;
}

/**
 * The route reads the habit, then upserts the entry — two `from()` calls with different
 * shapes, so the double dispatches on the table name.
 */
function makeMockSupabase({
  signedOut = false,
  habit = HABIT,
  loadError,
  upsertError,
  startMoveError,
}: Options = {}) {
  const moveStart = jest.fn().mockResolvedValue({ error: startMoveError });
  const habits = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: habit, error: loadError }),
    // The start move ends in its own `.eq()`, so it gets its own chain rather than sharing the
    // read's `mockReturnThis` one.
    update: jest.fn<unknown, [Record<string, unknown>]>(() => ({ eq: moveStart })),
    _moveStart: moveStart,
  };
  const entries = {
    upsert: jest.fn<unknown, [Record<string, unknown>, unknown]>().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    single: jest.fn(),
  };
  // Echo back whatever row the route asked to write, the way the database does.
  entries.single.mockImplementation(() =>
    Promise.resolve(
      upsertError === undefined
        ? {
            data: { id: 'entry-1', habit_id: HABIT_ID, ...entries.upsert.mock.calls.at(-1)?.[0] },
            error: undefined,
          }
        : { data: undefined, error: upsertError },
    ),
  );
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: signedOut ? undefined : TEST_USER } }),
    },
    from: jest.fn((table: string) => (table === 'habits' ? habits : entries)),
    _habits: habits,
    _entries: entries,
  };
}

function put(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/habits/${HABIT_ID}/entries`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function context(id: string = HABIT_ID) {
  return { params: Promise.resolve({ id }) };
}

/** A signed-in session over a habit that exists. */
function signedIn(options: Options = {}) {
  const supabase = makeMockSupabase(options);
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

/** The row the route asked the database to write. */
function upserted(supabase: ReturnType<typeof makeMockSupabase>): Record<string, unknown> {
  return supabase._entries.upsert.mock.calls.at(-1)?.[0] ?? {};
}

beforeEach(() => {
  process.env.INGEST_API_KEY = API_KEY;
});

describe('PUT /api/habits/[id]/entries — deriving and freezing the status', () => {
  it.each([
    ['met', { wake: 364, light: true }],
    ['partial', { wake: 364, light: false }],
    ['missed', { wake: 700, light: false }],
  ])('scores the evidence as %s and stores both', async (status, results) => {
    const supabase = signedIn();

    const response = await PUT(put({ date: '2026-07-27', results }), context());

    expect(response.status).toBe(200);
    expect(upserted(supabase)).toMatchObject({
      habit_id: HABIT_ID,
      entry_date: '2026-07-27',
      status,
      results,
    });
  });

  it('upserts on (habit_id, entry_date), so logging the same day twice leaves one row', async () => {
    const supabase = signedIn();

    await PUT(put({ date: '2026-07-27', results: { light: true } }), context());
    await PUT(put({ date: '2026-07-27', results: { wake: 364, light: true } }), context());

    expect(supabase._entries.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: 'met' }),
      { onConflict: 'habit_id,entry_date' },
    );
  });

  it('stamps updated_at from the writer, since no trigger does', async () => {
    const supabase = signedIn();

    await PUT(put({ date: '2026-07-27', results: { light: true } }), context());

    expect(typeof upserted(supabase)['updated_at']).toBe('string');
  });

  it('clears a previous skip’s reason when the day is corrected to a logged one', async () => {
    const supabase = signedIn();

    await PUT(put({ date: '2026-07-27', results: { light: true } }), context());

    expect(upserted(supabase)['note']).toBeNull();
  });
});

describe('PUT /api/habits/[id]/entries — what a caller may state', () => {
  it('accepts skipped with a reason, and stores the reason', async () => {
    const supabase = signedIn();

    const response = await PUT(
      put({ date: '2026-07-27', status: 'skipped', note: 'flu, off all week' }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(upserted(supabase)).toMatchObject({ status: 'skipped', note: 'flu, off all week' });
  });

  it.each([
    ['absent', { date: '2026-07-27', status: 'skipped' }],
    ['empty', { date: '2026-07-27', status: 'skipped', note: '' }],
    ['whitespace-only', { date: '2026-07-27', status: 'skipped', note: '   \n ' }],
    ['null', { date: '2026-07-27', status: 'skipped', note: null }],
  ])('rejects a skip whose reason is %s with 400', async (_case, body) => {
    const supabase = signedIn();

    const response = await PUT(put(body), context());

    expect(response.status).toBe(400);
    expect(supabase._entries.upsert).not.toHaveBeenCalled();
  });

  it.each(['met', 'partial', 'missed'])(
    'rejects an explicitly stated %s with 400 — a caller sends evidence, not a verdict',
    async (status) => {
      const supabase = signedIn();

      const response = await PUT(
        put({ date: '2026-07-27', results: { light: true }, status }),
        context(),
      );

      expect(response.status).toBe(400);
      expect(supabase._entries.upsert).not.toHaveBeenCalled();
    },
  );

  it('rejects a body carrying neither results nor a status with 400', async () => {
    const supabase = signedIn();

    const response = await PUT(put({ date: '2026-07-27' }), context());

    expect(response.status).toBe(400);
    expect(supabase._entries.upsert).not.toHaveBeenCalled();
  });
});

describe('PUT /api/habits/[id]/entries — which day it means', () => {
  it('defaults the date to today in the caller’s zone', async () => {
    const supabase = signedIn();

    await PUT(put({ tz: 'America/New_York', results: { light: true } }), context());

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    expect(upserted(supabase)['entry_date']).toBe(today);
  });

  it('falls back to UTC for an unrecognized zone rather than 400-ing', async () => {
    const supabase = signedIn();

    const response = await PUT(
      put({ tz: 'Mars/Olympus_Mons', results: { light: true } }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(upserted(supabase)['entry_date']).toBe(new Date().toISOString().slice(0, 10));
  });

  it('rejects a future date with 400', async () => {
    const supabase = signedIn();

    const response = await PUT(put({ date: '2099-01-01', results: { light: true } }), context());

    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({ error: 'Cannot log a day in the future' });
    expect(supabase._entries.upsert).not.toHaveBeenCalled();
  });

  it('accepts a date before the habit started, moving the start back to it', async () => {
    const supabase = signedIn();

    const response = await PUT(put({ date: '2026-06-30', results: { light: true } }), context());

    expect(response.status).toBe(200);
    expect(upserted(supabase)['entry_date']).toBe('2026-06-30');
    // The definition follows the evidence: a day the owner kept is a day the habit was running.
    expect(supabase._habits.update).toHaveBeenCalledWith({ started_on: '2026-06-30' });
    expect(supabase._habits._moveStart).toHaveBeenCalledWith('id', HABIT_ID);
  });

  it('moves the start for a pre-start SKIP too — one rule, whatever the verdict', async () => {
    const supabase = signedIn();

    const response = await PUT(
      put({ date: '2026-06-30', status: 'skipped', note: 'travelling' }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(supabase._habits.update).toHaveBeenCalledWith({ started_on: '2026-06-30' });
  });

  it('leaves the start alone for a day the habit was already running on', async () => {
    const supabase = signedIn();

    const response = await PUT(put({ date: '2026-07-01', results: { light: true } }), context());

    expect(response.status).toBe(200);
    expect(supabase._habits.update).not.toHaveBeenCalled();
  });

  it('writes the entry BEFORE moving the start, and surfaces a failed move', async () => {
    // The safe order: a stored entry the habit has not reached yet is invisible and re-logging
    // fixes it, whereas a moved start with no entry breaks a chain in exchange for nothing.
    const supabase = signedIn({
      startMoveError: { message: 'permission denied for table habits' },
    });

    const response = await PUT(put({ date: '2026-06-30', results: { light: true } }), context());

    expect(supabase._entries.upsert).toHaveBeenCalled();
    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({
      error: 'permission denied for table habits',
    });
  });

  it('rejects an id that is not a UUID with 400', async () => {
    signedIn();

    const response = await PUT(put({ results: { light: true } }), context('not-a-uuid'));

    expect(response.status).toBe(400);
  });

  it('returns 404 for a habit that does not exist', async () => {
    signedIn({ habit: null });

    const response = await PUT(put({ date: '2026-07-27', results: { light: true } }), context());

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({ error: 'Habit not found' });
  });
});

describe('PUT /api/habits/[id]/entries — auth', () => {
  it('returns 401 with neither a session nor a key', async () => {
    signedIn({ signedOut: true });

    const response = await PUT(put({ date: '2026-07-27', results: { light: true } }), context());

    expect(response.status).toBe(401);
  });

  it('accepts a logged-in session', async () => {
    signedIn();

    const response = await PUT(put({ date: '2026-07-27', results: { light: true } }), context());

    expect(response.status).toBe(200);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('routes a valid API key through the admin client — this is the coach’s write', async () => {
    const admin = makeMockSupabase({ signedOut: true });
    mockCreateAdminClient.mockReturnValue(admin as never);

    const response = await PUT(
      put({ date: '2026-07-27', results: { light: true } }, { 'x-api-key': API_KEY }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mockCreateAdminClient).toHaveBeenCalled();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });
});

describe('PUT /api/habits/[id]/entries — database failures', () => {
  it('maps a failed habit load through the shared error envelope', async () => {
    signedIn({ habit: undefined, loadError: { message: 'DB exploded' } });

    const response = await PUT(put({ date: '2026-07-27', results: { light: true } }), context());

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({ error: 'DB exploded' });
  });

  it('maps a failed upsert through the shared error envelope', async () => {
    signedIn({ upsertError: { message: 'nope', code: '23505' } });

    const response = await PUT(put({ date: '2026-07-27', results: { light: true } }), context());

    expect(response.status).toBe(409);
  });
});
