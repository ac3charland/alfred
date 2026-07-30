/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';

import { DELETE, PATCH } from './route';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

const mockCreateClient = jest.mocked(createClient);

const API_KEY = 'test-ingest-key';
const TEST_USER = { id: 'user-123' };
const TEST_ID = '00000000-0000-4000-8000-000000000001';

const CRITERIA = [{ key: 'wake', label: 'be up by', kind: 'time', target: 420, comparator: 'lte' }];

const STORED = {
  id: TEST_ID,
  name: 'Morning routine',
  notes: null,
  criteria: CRITERIA,
  active_days: [1, 2, 3, 4, 5],
  allowance: 1,
  started_on: '2026-06-12',
  archived_at: null,
  sort_order: null,
  created_at: '2026-06-12T08:00:00Z',
};

interface MockError {
  message: string;
  code?: string;
}

/**
 * A Supabase double whose `habits` and `habit_entries` tables answer separately: PATCH reads
 * the habit, may count the entries, then writes the habit, so one shared chain couldn't tell
 * the read's result from the write's.
 */
function makeMockSupabase(
  user: { id: string } | undefined,
  options: {
    stored?: unknown;
    updated?: unknown;
    entryCount?: number;
    loadError?: MockError;
    updateError?: MockError;
    countError?: MockError;
    deleteError?: MockError;
  } = {},
) {
  const habits = {
    select: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn(),
    eq: jest.fn().mockReturnThis(),
    // `'stored' in options`, not `??`: a test naming `stored: null` means "no such row", which
    // a nullish default would quietly turn back into the fixture.
    maybeSingle: jest.fn().mockResolvedValue({
      data:
        options.loadError === undefined ? ('stored' in options ? options.stored : STORED) : null,
      error: options.loadError,
    }),
    single: jest.fn().mockResolvedValue({
      data: options.updateError === undefined ? (options.updated ?? STORED) : null,
      error: options.updateError,
    }),
  };
  // `.delete().eq(...)` is awaited directly rather than closed by `.single()`.
  habits.delete.mockReturnValue({
    eq: jest.fn().mockResolvedValue({ error: options.deleteError }),
  });

  const entries = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockResolvedValue({
      count: options.entryCount ?? 0,
      error: options.countError,
    }),
  };

  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn((table: string) => (table === 'habits' ? habits : entries)),
    _habits: habits,
    _entries: entries,
  };
}

function signedIn(options: Parameters<typeof makeMockSupabase>[1] = {}) {
  const supabase = makeMockSupabase(TEST_USER, options);
  mockCreateClient.mockResolvedValue(supabase as never);
  return supabase;
}

function patch(body: unknown, headers: Record<string, string> = {}, id = TEST_ID): Request {
  return new Request(`http://localhost/api/habits/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function del(id = TEST_ID, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/habits/${id}`, { method: 'DELETE', headers });
}

const context = { params: Promise.resolve({ id: TEST_ID }) };

beforeEach(() => {
  process.env.INGEST_API_KEY = API_KEY;
});

describe('PATCH /api/habits/[id]', () => {
  it('renames a habit and returns the full updated row', async () => {
    const supabase = signedIn({ updated: { ...STORED, name: 'Mornings' } });

    const response = await PATCH(patch({ name: 'Mornings' }), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ ...STORED, name: 'Mornings' });
    expect(supabase._habits.update).toHaveBeenCalledWith({ name: 'Mornings' });
  });

  it('replaces the criteria wholesale', async () => {
    const retargeted = [
      { key: 'wake', label: 'be up by', kind: 'time', target: 375, comparator: 'lte' },
    ];
    const supabase = signedIn();

    const response = await PATCH(patch({ criteria: retargeted }), context);

    expect(response.status).toBe(200);
    expect(supabase._habits.update).toHaveBeenCalledWith({ criteria: retargeted });
  });

  it('clears notes when the body sends null', async () => {
    const supabase = signedIn();

    const response = await PATCH(patch({ notes: null }), context);

    expect(response.status).toBe(200);
    expect(supabase._habits.update).toHaveBeenCalledWith({ notes: null });
  });

  // The form submits the fields it rendered, so an unchanged resend must not fail the save.
  it('accepts a locked field resent unchanged on a habit with history', async () => {
    const supabase = signedIn({ entryCount: 63 });

    const response = await PATCH(
      patch({ name: 'Mornings', active_days: [5, 4, 3, 2, 1], allowance: 1 }),
      context,
    );

    expect(response.status).toBe(200);
    // Never even counted the entries: nothing locked actually changed.
    expect(supabase.from).not.toHaveBeenCalledWith('habit_entries');
  });

  it('lets a locked field change on a habit with no entries', async () => {
    const supabase = signedIn({ entryCount: 0 });

    const response = await PATCH(patch({ allowance: 3 }), context);

    expect(response.status).toBe(200);
    expect(supabase._habits.update).toHaveBeenCalledWith({ allowance: 3 });
  });

  it('refuses a locked change on a habit with history, naming the field and the days', async () => {
    const supabase = signedIn({ entryCount: 63 });

    const response = await PATCH(patch({ allowance: 3 }), context);

    expect(response.status).toBe(409);
    expect(await response.json()).toStrictEqual({
      error: 'allowance is fixed once a habit has history — Morning routine has 63 logged days',
    });
    expect(supabase._habits.update).not.toHaveBeenCalled();
  });

  it('names every locked field a refused body changed', async () => {
    signedIn({ entryCount: 12 });

    const response = await PATCH(
      patch({ active_days: [1, 2], allowance: 4, started_on: '2026-01-01' }),
      context,
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe(
      'active_days, allowance and started_on are fixed once a habit has history — Morning routine has 12 logged days',
    );
  });

  it('stamps archived_at server-side for archived: true', async () => {
    const supabase = signedIn();

    const response = await PATCH(patch({ archived: true }), context);

    expect(response.status).toBe(200);
    const [[updates]] = supabase._habits.update.mock.calls as [[{ archived_at: string }]];
    expect(Date.parse(updates.archived_at)).not.toBeNaN();
    expect(updates).not.toHaveProperty('archived');
  });

  it('nulls archived_at for archived: false', async () => {
    const supabase = signedIn({ stored: { ...STORED, archived_at: '2026-07-01T00:00:00Z' } });

    const response = await PATCH(patch({ archived: false }), context);

    expect(response.status).toBe(200);
    expect(supabase._habits.update).toHaveBeenCalledWith({ archived_at: null });
  });

  it('returns 404 for an id that is not there', async () => {
    signedIn({ stored: null });

    const response = await PATCH(patch({ name: 'Mornings' }), context);

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({ error: 'Habit not found' });
  });

  it('returns 400 for a malformed id, before touching the database', async () => {
    const supabase = signedIn();

    const response = await PATCH(patch({ name: 'Mornings' }, {}, 'not-a-uuid'), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });

    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns 400 for a body with no fields to update', async () => {
    signedIn();

    const response = await PATCH(patch({}), context);

    expect(response.status).toBe(400);
  });

  it('returns 400 for criteria with duplicate keys', async () => {
    signedIn();

    const response = await PATCH(
      patch({
        criteria: [
          { key: 'wake', label: 'be up by', kind: 'time', target: 420, comparator: 'lte' },
          { key: 'wake', label: 'again', kind: 'boolean' },
        ],
      }),
      context,
    );

    expect(response.status).toBe(400);
  });

  it('returns 400 for an allowance outside 0–7', async () => {
    signedIn();

    const response = await PATCH(patch({ allowance: 8 }), context);

    expect(response.status).toBe(400);
  });

  it('returns 401 with no session', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase(undefined) as never);

    const response = await PATCH(patch({ name: 'Mornings' }), context);

    expect(response.status).toBe(401);
  });

  // Epic D7: the ingest key logs days. It does not define or destroy things.
  it('returns 401 for a valid API key with no session', async () => {
    const supabase = makeMockSupabase(undefined);
    mockCreateClient.mockResolvedValue(supabase as never);

    const response = await PATCH(patch({ name: 'Mornings' }, { 'x-api-key': API_KEY }), context);

    expect(response.status).toBe(401);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('maps a Postgres failure on the update through the shared mapper', async () => {
    signedIn({ updateError: { message: 'boom' } });

    const response = await PATCH(patch({ name: 'Mornings' }), context);

    expect(response.status).toBe(500);
  });

  it('maps a Postgres failure on the read through the shared mapper', async () => {
    signedIn({ loadError: { message: 'boom' } });

    const response = await PATCH(patch({ name: 'Mornings' }), context);

    expect(response.status).toBe(500);
  });

  it('maps a Postgres failure on the entry count through the shared mapper', async () => {
    signedIn({ countError: { message: 'boom' } });

    const response = await PATCH(patch({ allowance: 3 }), context);

    expect(response.status).toBe(500);
  });
});

describe('DELETE /api/habits/[id]', () => {
  it('deletes the habit and reports success', async () => {
    const supabase = signedIn();

    const response = await DELETE(del(), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ success: true });
    expect(supabase.from).toHaveBeenCalledWith('habits');
    expect(supabase._habits.delete).toHaveBeenCalledWith();
  });

  it('returns 400 for a malformed id, before touching the database', async () => {
    const supabase = signedIn();

    const response = await DELETE(del('nope'), { params: Promise.resolve({ id: 'nope' }) });

    expect(response.status).toBe(400);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('returns 401 with no session', async () => {
    mockCreateClient.mockResolvedValue(makeMockSupabase(undefined) as never);

    const response = await DELETE(del(), context);

    expect(response.status).toBe(401);
  });

  it('returns 401 for a valid API key with no session', async () => {
    const supabase = makeMockSupabase(undefined);
    mockCreateClient.mockResolvedValue(supabase as never);

    const response = await DELETE(del(TEST_ID, { 'x-api-key': API_KEY }), context);

    expect(response.status).toBe(401);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('maps a Postgres failure through the shared mapper', async () => {
    signedIn({ deleteError: { message: 'boom' } });

    const response = await DELETE(del(), context);

    expect(response.status).toBe(500);
  });
});
