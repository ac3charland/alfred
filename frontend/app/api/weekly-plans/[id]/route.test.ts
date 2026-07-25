/** @jest-environment @stryker-mutator/jest-runner/jest-env/node */
import { createClient } from '@/lib/supabase/server';

import { GET } from './route';

// `withSession` pulls in lib/api/auth, which transitively imports the server-only admin
// client; neutralise `import 'server-only'` so it doesn't throw under Jest.
jest.mock('server-only', () => ({}));

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

const mockCreateClient = jest.mocked(createClient);

const TEST_USER = { id: 'user-123' };
const PLAN_ID = 'e4f5a6b7-c8d9-4e0f-a1b2-c3d4e5f6a7b8';
const PLAN = {
  id: PLAN_ID,
  html: '<!DOCTYPE html><html><body><h1>Week 12</h1></body></html>',
  uploaded_at: '2026-07-24T21:03:11.482Z',
};

interface MockResult {
  data: unknown;
  error: { message: string; code?: string } | undefined;
}

function makeQueryChain(result: MockResult) {
  return {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
}

function makeMockSupabase(user: { id: string } | undefined, result: MockResult) {
  const chain = makeQueryChain(result);
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn().mockReturnValue(chain),
    _chain: chain,
  };
}

function getPlan(id: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/weekly-plans/${id}`), {
    params: Promise.resolve({ id }),
  });
}

// ---------------------------------------------------------------------------
// GET /api/weekly-plans/[id]
// ---------------------------------------------------------------------------

describe('GET /api/weekly-plans/[id]', () => {
  it('returns 401 without a session — the API key is a write credential only', async () => {
    const mockSupabase = makeMockSupabase(undefined, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await getPlan(PLAN_ID);

    expect(response.status).toBe(401);
  });

  it('returns 400 for a non-UUID id', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: undefined, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await getPlan('not-a-uuid');

    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({ error: 'Invalid id' });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown id', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: null, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await getPlan(PLAN_ID);

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({ error: 'Weekly plan not found' });
  });

  it('returns 200 with the document for a known id', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, { data: PLAN, error: undefined });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await getPlan(PLAN_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual(PLAN);
    expect(mockSupabase.from).toHaveBeenCalledWith('weekly_plans');
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('id', PLAN_ID);
  });

  it('maps a Supabase read failure through the shared error envelope', async () => {
    const mockSupabase = makeMockSupabase(TEST_USER, {
      data: undefined,
      error: { message: 'DB exploded' },
    });
    mockCreateClient.mockResolvedValue(mockSupabase as never);

    const response = await getPlan(PLAN_ID);

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({ error: 'DB exploded' });
  });
});
