/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';

import { POST } from './route';

jest.mock('@/lib/supabase/server', () => ({ createClient: jest.fn() }));
jest.mock('@/lib/supabase/admin', () => ({ createAdminClient: jest.fn() }));

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
